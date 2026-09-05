// @vitest-environment node
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ReservationWithJoins } from '@/lib/salon/types'

/**
 * Smoke de render del tablero operativo: el primer paint (SSR) de la pantalla
 * con una noche realista tiene que salir sin tirar y con lo importante puesto.
 * No prueba interacción (para eso está el smoke manual): prueba que ninguna
 * pieza explota al montar con datos reales, que es donde suelen romperse las
 * pantallas grandes (un join que llega null, un estado sin rama, un import
 * server-only en un client component).
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/hub/operativo',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    createElement('a', { href, ...rest }, children),
}))
vi.mock('@/lib/salon/actions', () => ({
  markArrived: vi.fn(),
  markNoShow: vi.fn(),
  revertStatus: vi.fn(),
  updateActualGuests: vi.fn(),
  updateReservationTableLabel: vi.fn(),
  updateSalonReservation: vi.fn(),
  closeTable: vi.fn(),
  linkReservationCustomer: vi.fn(),
}))
vi.mock('@/lib/points/actions', () => ({ awardPointsByAmount: vi.fn() }))
vi.mock('@/lib/salon/client-actions', () => ({
  fetchOperativoExtras: vi.fn(),
  fetchReservationsForDate: vi.fn(),
}))
vi.mock('@/lib/realtime/subscribe', () => ({ subscribeChanges: () => () => {} }))
vi.mock('@/components/messaging/contact-button', () => ({
  ContactButton: () => createElement('button', { type: 'button' }, 'Contactar'),
}))
vi.mock('@/app/(manager)/[tenantSlug]/acreditar/_components/punch-stamper', () => ({
  PunchStamper: () => createElement('div', null, 'stamper'),
}))

function reservation(over: Partial<ReservationWithJoins>): ReservationWithJoins {
  return {
    id: 'r',
    tenant_id: 't',
    customer_id: null,
    guest_name: 'Nombre',
    guest_phone: null,
    guest_email: null,
    kind: 'normal',
    meal_type: 'dinner',
    reservation_date: '2026-09-05',
    reservation_time_local: '21:00:00',
    reservation_end_time_local: null,
    zone: 'planta_alta',
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

const NIGHT: ReservationWithJoins[] = [
  reservation({
    id: 'a',
    guest_name: 'Enrique Vives',
    reservation_time_local: '13:30:00',
    meal_type: 'lunch',
    estimated_guests: 2,
    status: 'closed',
    closed_at: '2026-09-05T18:00:00Z',
    actual_guests: 2,
    table_label: '4',
  }),
  reservation({
    id: 'b',
    guest_name: 'Aldana Antonutti',
    reservation_time_local: '20:30:00',
    estimated_guests: 24,
    service_alerts: ['celiac', 'reduced_mobility'],
    customer: {
      id: 'c1',
      first_name: 'Aldana',
      last_name: 'Antonutti',
      phone: '+5493515551234',
      service_alerts: [],
      points_balance: 1250,
      tier: { name: 'Gold', color: '#b8860b' },
    },
    customer_id: 'c1',
  }),
  reservation({
    id: 'c',
    guest_name: 'Adriana Carranza',
    reservation_time_local: '21:00:00',
    estimated_guests: 20,
    status: 'arrived',
    actual_guests: 18,
    arrived_at: '2026-09-06T00:05:00Z',
    table_label: '12+13',
  }),
  reservation({
    id: 'd',
    guest_name: 'Rosario Garip',
    reservation_time_local: '21:00:00',
    estimated_guests: 22,
    kind: 'birthday',
    cake_count: 1,
    cake_option_id: 'k1',
    cake_option: { id: 'k1', name: 'Opción 2', base: 'Chocolate', fillings: ['Dulce de leche'] },
    champagne_count: 1,
    comments: 'Silla de ruedas eléctrica',
    highlight_comment: true,
    scheduled_event_id: 'ev',
    zone: 'event_floating',
    scheduled_event: {
      id: 'ev',
      capacity: 140,
      starts_at_local: '21:00:00',
      meal_type: 'dinner',
      template: {
        id: 'tpl',
        name: 'Pizza libre',
        slug: 'pizza',
        color_hex: '#e11d48',
        consume_special_reservations: true,
      },
    },
  }),
  reservation({
    id: 'e',
    guest_name: 'Maximiliano García',
    reservation_time_local: '22:30:00',
    estimated_guests: 6,
    status: 'no_show',
  }),
  reservation({
    id: 'f',
    guest_name: 'Cancelada Pérez',
    reservation_time_local: '23:00:00',
    estimated_guests: 3,
    status: 'cancelled',
    cancelled_reason: 'Se enfermó',
  }),
  reservation({
    id: 'g',
    guest_name: 'Trasnoche Ruiz',
    reservation_time_local: '00:30:00',
    estimated_guests: 5,
  }),
]

describe('OperativoBoard (SSR)', () => {
  it('renderiza una noche completa sin tirar', async () => {
    const { OperativoBoard } = await import(
      '@/app/(manager)/[tenantSlug]/operativo/_components/operativo-board'
    )
    const html = renderToString(
      createElement(OperativoBoard, {
        tenantSlug: 'hub',
        tenantId: 't',
        role: 'owner',
        date: '2026-09-05',
        today: '2026-09-05',
        initialReservations: NIGHT,
        initialCapacity: [
          { bucket: 'zone:planta_alta', used: 44, capacity: 60, available: 16 },
          { bucket: 'zone:planta_baja', used: 26, capacity: 80, available: 54 },
          { bucket: 'zone:event_floating', used: 22, capacity: 0, available: 0 },
          { bucket: 'event:ev', used: 22, capacity: 140, available: 118 },
        ],
        initialEvents: [
          {
            id: 'ev',
            tenant_id: 't',
            template_id: 'tpl',
            name_override: null,
            event_date: '2026-09-05',
            starts_at_local: '21:00:00',
            ends_at_local: null,
            capacity: 140,
            meal_type: 'dinner',
            full_bonus_active: true,
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
              default_capacity: 140,
            },
          },
        ],
        initialAwards: [
          {
            customer_id: 'c1',
            points: 120,
            amount_cents: 1200000,
            created_at: '2026-09-05T23:41:00Z',
          },
        ],
        earnRate: { points: 1, everyCents: 100000 },
        canOperate: true,
        canAward: true,
        canLink: true,
        isOwner: true,
      }),
    )

    // Lo que tiene que estar en el primer paint.
    expect(html).toContain('Aldana Antonutti')
    expect(html).toContain('Adriana Carranza')
    expect(html).toContain('12+13') // la mesa en el riel
    expect(html).toContain('Llegó') // la acción primaria
    expect(html).toContain('Apareció') // reversión de no vino
    expect(html).toContain('Pizza libre') // el hito del evento
    expect(html).toContain('Opción 2') // qué torta
    expect(html).toContain('Canceladas') // sección colapsada
    expect(html).toContain('Almuerzo')
    expect(html).toContain('Cena')
    // Sin marcador de "ahora" en SSR (el reloj arranca en null para no romper la hidratación).
    expect(html).not.toContain('data-now-marker')
  })

  it('renderiza un día vacío y uno futuro', async () => {
    const { OperativoBoard } = await import(
      '@/app/(manager)/[tenantSlug]/operativo/_components/operativo-board'
    )
    const base = {
      tenantSlug: 'hub',
      tenantId: 't',
      role: 'host' as const,
      initialCapacity: [],
      initialEvents: [],
      initialAwards: [],
      earnRate: null,
      canOperate: true,
      canAward: false,
      canLink: true,
      isOwner: false,
    }
    const empty = renderToString(
      createElement(OperativoBoard, {
        ...base,
        date: '2026-09-05',
        today: '2026-09-05',
        initialReservations: [],
      }),
    )
    expect(empty).toContain('Nada reservado para hoy')

    const future = renderToString(
      createElement(OperativoBoard, {
        ...base,
        date: '2026-09-07',
        today: '2026-09-05',
        initialReservations: [reservation({ id: 'x', reservation_date: '2026-09-07' })],
      }),
    )
    expect(future).toContain('todavía no se puede marcar llegadas')
    expect(future).not.toContain('>Llegó<')
  })
})
