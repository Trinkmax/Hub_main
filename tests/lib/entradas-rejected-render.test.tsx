// @vitest-environment node
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { PublicOrder } from '@/lib/ticketing/types'

/**
 * El pago rechazado en el primer paint: con cuenta cargada aparece cómo transferir; sin cuenta,
 * queda como siempre.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/lib/ticketing/checkout-actions', () => ({ refreshOrder: vi.fn() }))

const { RejectedTicket } = await import(
  '@/app/entradas/[tenantSlug]/mi-entrada/[orderId]/_components/order-view'
)

const order = {
  id: '11111111-1111-4111-8111-111111111111',
  shortCode: 'E38D8CEB',
  status: 'rejected',
  expired: false,
  holdExpiresAt: '2026-11-05T00:30:00.000Z',
  title: 'Shrek 2',
  date: '2026-12-01',
  time: '21:00',
  partySize: 2,
  option: 'deposit',
  totalCents: 4_000_000,
  guestFirstName: 'Juan',
} as PublicOrder

function render(props: {
  transfer: { alias: string; holder: string | null } | null
  whatsapp: string | null
}) {
  return renderToString(
    <RejectedTicket
      order={order}
      tenantName="Mi Bar"
      header={null}
      reason="Mercado Pago no aprobó el pago por seguridad."
      retryUrl="https://mp.test/pagar"
      restartUrl="/entradas/mi-bar/shrek-2"
      {...props}
    />,
  )
}

describe('RejectedTicket', () => {
  it('con cuenta y WhatsApp: el alias, a quién, cuánto y cómo mandar el comprobante', () => {
    const html = render({
      transfer: { alias: 'mi.bar.pagos', holder: 'Mi Bar S.A.S.' },
      whatsapp: '+5493515551234',
    })
    expect(html).toContain('mi.bar.pagos')
    expect(html).toContain('Mi Bar S.A.S.')
    expect(html).toContain('Transferí la seña')
    expect(html).toContain('40.000')
    expect(html).toContain('Ya transferí: mandar comprobante')
    expect(html).toContain('https://wa.me/5493515551234?text=')
    // Reintentar sigue estando.
    expect(html).toContain('Reintentar con Mercado Pago')
  })

  it('con cuenta y sin WhatsApp: el alias y qué pasa después, sin un botón que no lleva a nada', () => {
    const html = render({ transfer: { alias: 'mi.bar.pagos', holder: null }, whatsapp: null })
    expect(html).toContain('mi.bar.pagos')
    expect(html).toContain('te confirmamos por WhatsApp')
    expect(html).not.toContain('wa.me')
    expect(html).not.toContain('A nombre de')
  })

  it('sin cuenta: no ofrece transferir', () => {
    const html = render({ transfer: null, whatsapp: '+5493515551234' })
    expect(html).not.toContain('Transferí')
    expect(html).toContain('Reintentar con Mercado Pago')
    expect(html).toContain('Empezar de nuevo')
  })
})
