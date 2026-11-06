// @vitest-environment node
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AdminOrder } from '@/lib/ticketing/queries'
import { groupSalesByDay, salesPage } from '@/lib/ticketing/sales-days'

/**
 * Ventas online en el primer paint (SSR): las compras por día, con lo que cada uno puede hacer.
 * El dueño confirma, devuelve y anula; la anfitriona solo confirma (pedido del 06/11/2026).
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/hub/ventas-online',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/lib/ticketing/actions', () => ({
  confirmTicketTransfer: vi.fn(),
  voidTicketTransfer: vi.fn(),
  refundTicketOrder: vi.fn(),
}))

const { SalesList } = await import(
  '@/app/(manager)/[tenantSlug]/ventas-online/_components/sales-list'
)

const NOW = new Date('2026-10-26T21:00:00.000Z') // lunes 26/10, 18:00 en Córdoba
const PAGE = salesPage(undefined, NOW)

const text = (html: string) =>
  html
    // Los separadores de texto de React (`<!-- -->`) no son espacios.
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')

function order(over: Partial<AdminOrder>): AdminOrder {
  return {
    reservation: null,
    undo: null,
    mp_payment_type: null,
    id: 'o1',
    title: 'Shrek',
    event_date: '2026-12-01',
    event_time: '21:00:00',
    party_size: 2,
    payment_option: 'deposit',
    total_cents: 1_000_000,
    paid_cents: null,
    guest_name: 'Ana Gómez',
    guest_phone: '+5493515551234',
    status: 'pending',
    hold_expires_at: '2026-10-26T21:10:00.000Z',
    reservation_id: null,
    attention: null,
    mp_status_detail: null,
    created_at: '2026-10-26T20:42:00.000Z',
    paid_at: null,
    ...over,
  }
}

function render(
  orders: AdminOrder[],
  opts: {
    transferEnabled?: boolean
    canManageMoney?: boolean
    previousTo?: string | null
    page?: ReturnType<typeof salesPage>
  } = {},
) {
  return renderToString(
    createElement(SalesList, {
      tenantSlug: 'hub',
      appUrl: 'https://hub.test',
      result: { ok: true, days: groupSalesByDay(orders), previousTo: opts.previousTo ?? null },
      page: opts.page ?? PAGE,
      now: NOW,
      transferEnabled: opts.transferEnabled ?? false,
      canManageMoney: opts.canManageMoney ?? true,
    }),
  )
}

describe('Ventas online — cada compra', () => {
  it('su estado, su aviso, la hora y el link a la reserva', () => {
    const html = render([
      order({ id: 'a', status: 'approved', paid_cents: 1_000_000, reservation_id: 'r-1' }),
      order({ id: 'b', status: 'pending' }),
      order({ id: 'c', status: 'rejected', hold_expires_at: '2026-10-26T20:00:00.000Z' }),
      order({
        id: 'd',
        status: 'approved',
        paid_cents: 1_000_000,
        attention: 'event_missing',
        event_date: '2026-12-15',
      }),
      order({
        id: 'e',
        status: 'approved',
        paid_cents: 1_000_000,
        reservation_id: 'r-2',
        attention: 'overbooked',
      }),
    ])
    const t = text(html)
    expect(t).toContain('Pagado')
    expect(t).toContain('Pagando…')
    expect(t).toContain('Sin pagar')
    expect(t).toContain('Sobrecupo')
    expect(t).toContain('Sin fecha: cargá la reserva a mano')
    expect(t).toContain('+54 9 351 555-1234')
    expect(t).toContain('Mar 01 dic 21:00')
    // El día va en el título de la tanda: en cada compra, solo la hora.
    expect(t).toContain('17:42')
    expect(t).not.toContain('Hoy 17:42')
    expect(html).toContain('href="/hub/reservas/r-1"')
    expect(html).toContain('href="/hub/reservas/nuevo?date=2026-12-15"')
    // La entrada se le puede mandar a quien pagó, por su WhatsApp, y a nadie más.
    expect(t).toContain('Mandar entrada')
    expect(html).toContain('https://wa.me/5493515551234?text=')
    expect(html).toContain(encodeURIComponent('https://hub.test/entradas/hub/mi-entrada/'))
  })

  it('dice si ya entraron: de una o de a partes', () => {
    const t = text(
      render([
        order({
          id: 'o-1',
          status: 'approved',
          reservation_id: 'r-1',
          reservation: {
            status: 'arrived',
            estimated_guests: 2,
            actual_guests: 2,
            arrived_at: '2026-12-02T00:04:00Z',
          },
        }),
        order({
          id: 'o-2',
          status: 'approved',
          party_size: 4,
          reservation_id: 'r-2',
          reservation: {
            status: 'arrived',
            estimated_guests: 4,
            actual_guests: 2,
            arrived_at: '2026-12-02T00:10:00Z',
          },
        }),
      ]),
    )
    expect(t).toContain('Entraron · 21:04')
    expect(t).toContain('Entraron 2 de 4 · 21:10')
  })
})

describe('Ventas online — por día', () => {
  it('una tarjeta por día, la más nueva arriba, con lo cobrado y lo que quedó sin pagar', () => {
    const html = render([
      order({ id: 'hoy-1', status: 'approved', paid_cents: 1_000_000 }),
      order({ id: 'hoy-2', status: 'rejected', guest_name: 'Rechazada' }),
      order({
        id: 'ayer-1',
        status: 'approved',
        paid_cents: 2_000_000,
        guest_name: 'Beto Ayer',
        created_at: '2026-10-25T23:00:00.000Z',
      }),
      order({
        id: 'antes-1',
        status: 'approved',
        paid_cents: 2_000_000,
        guest_name: 'Caro Antes',
        created_at: '2026-10-23T15:00:00.000Z',
      }),
    ])
    const t = text(html)
    expect(t).toContain('Hoy lunes 26 de octubre 1 pagada · $ 10.000 · 1 sin pagar')
    expect(t).toContain('Ayer domingo 25 de octubre 1 pagada · $ 20.000')
    expect(t).toContain('Viernes 23 de octubre 1 pagada · $ 20.000')
    expect(t.indexOf('Hoy')).toBeLessThan(t.indexOf('Ayer'))
    expect(t.indexOf('Ayer')).toBeLessThan(t.indexOf('Viernes 23'))
    // Cada día es una sección con su título, para saltar de día en día con el lector de pantalla.
    expect(html).toContain('aria-labelledby="dia-2026-10-26"')
    expect(html).toContain('id="dia-2026-10-23"')
  })

  it('«Ver días anteriores» lleva a la semana de la venta anterior', () => {
    const html = render([order({ id: 'a', status: 'approved' })], { previousTo: '2026-10-12' })
    expect(text(html)).toContain('Ver días anteriores')
    expect(html).toContain('href="/hub/ventas-online?hasta=2026-10-12"')
    // Esta semana no ofrece volver a ella misma.
    expect(text(html)).not.toContain('Volver a hoy')
  })

  it('en una semana vieja ofrece volver a hoy, y al llegar al principio lo dice', () => {
    const html = render(
      [order({ id: 'a', status: 'approved', created_at: '2026-10-14T15:00:00Z' })],
      {
        page: salesPage('2026-10-15', NOW),
      },
    )
    expect(text(html)).toContain('Volver a hoy')
    expect(html).toContain('href="/hub/ventas-online"')
    expect(text(html)).toContain('No hay ventas más viejas.')
  })

  it('una semana sin ventas no queda vacía: dice que las anteriores están abajo', () => {
    const html = render([], { previousTo: '2026-10-12' })
    expect(text(html)).toContain('No hubo ventas estos días')
    expect(text(html)).toContain('Ver días anteriores')
  })

  it('sin ninguna venta todavía y con error, cada uno con su texto', () => {
    expect(text(render([]))).toContain('Todavía no hubo ventas online')
    const failed = renderToString(
      createElement(SalesList, {
        tenantSlug: 'hub',
        appUrl: 'https://hub.test',
        result: { ok: false },
        page: PAGE,
        now: NOW,
      }),
    )
    expect(text(failed)).toContain('No pudimos cargar las ventas')
    expect(text(failed)).toContain('Reintentar')
  })
})

describe('Ventas online — quién puede qué', () => {
  const ORDERS = [
    order({ id: 'o-1', status: 'rejected', guest_name: 'Rechazada' }),
    order({
      id: 'o-2',
      status: 'approved',
      paid_cents: 1_000_000,
      reservation_id: 'r-2',
      mp_payment_type: 'manual_transfer',
    }),
    order({ id: 'o-3', status: 'approved', paid_cents: 1_000_000, reservation_id: 'r-3' }),
  ]

  it('el dueño: confirma lo que no se pagó, anula lo confirmado y devuelve lo de Mercado Pago', () => {
    const t = text(render(ORDERS, { transferEnabled: true, canManageMoney: true }))
    expect(t).toContain('Confirmar transferencia')
    expect(t).toContain('Transferencia')
    expect(t).toContain('Anular')
    expect(t).toContain('Devolver')
  })

  it('la anfitriona: confirma y manda la entrada, pero no devuelve ni anula', () => {
    const t = text(render(ORDERS, { transferEnabled: true, canManageMoney: false }))
    expect(t).toContain('Confirmar transferencia')
    expect(t).toContain('Mandar entrada')
    expect(t).toContain('Ver reserva')
    expect(t).not.toContain('Anular')
    expect(t).not.toContain('Devolver')
  })

  it('sin alias no hay nada que confirmar, para nadie', () => {
    for (const canManageMoney of [true, false]) {
      const t = text(render(ORDERS, { transferEnabled: false, canManageMoney }))
      expect(t).not.toContain('Confirmar transferencia')
    }
  })

  it('un «Deshacer» de la puerta queda a la vista de los dueños', () => {
    const t = text(
      render([
        order({
          id: 'o-1',
          status: 'approved',
          undo: { by: 'Luz', at: '2026-12-02T00:05:00Z', from: 4, to: 0 },
        }),
      ]),
    )
    expect(t).toContain('Deshizo Luz · 21:05')
  })
})
