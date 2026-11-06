// @vitest-environment node
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { PublicOrder } from '@/lib/ticketing/types'

/**
 * El pago rechazado en el primer paint: con cuenta cargada aparece cómo transferir; sin cuenta,
 * queda como siempre. Y pasada la hora del lugar guardado, la cuenta sigue a la vista mientras
 * la función tenga lugar.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/lib/ticketing/checkout-actions', () => ({ refreshOrder: vi.fn() }))

const { OrderView, RejectedTicket } = await import(
  '@/app/entradas/[tenantSlug]/mi-entrada/[orderId]/_components/order-view'
)

// 00:30 UTC son las 21:30 en Córdoba.
const order = {
  id: '11111111-1111-4111-8111-111111111111',
  shortCode: 'E38D8CEB',
  status: 'rejected',
  expired: false,
  holdExpiresAt: '2026-11-05T00:30:00.000Z',
  roomLeft: false,
  title: 'Shrek 2',
  date: '2026-12-01',
  time: '21:00',
  partySize: 2,
  option: 'deposit',
  unitPriceCents: 2_000_000,
  fullPriceCents: 4_500_000,
  totalCents: 4_000_000,
  balanceCashOnly: false,
  paidCents: null,
  guestFirstName: 'Juan',
  experienceSlug: 'shrek-2',
  posterUrl: null,
  accent: '#c0573e',
  priceNote: null,
  mpStatusDetail: 'rejected_high_risk',
  retryUrl: 'https://mp.test/pagar',
  guestShortName: 'Juan P.',
  mpPaymentId: null,
  mpPaymentType: 'account_money',
  paidAtLabel: null,
  terms: null,
  today: '2026-11-04',
  entry: { inside: 0, total: 2, atLabel: null, cancelled: false },
  qr: null,
} satisfies PublicOrder

const ACCOUNT = { alias: 'mi.bar.pagos', holder: 'Mi Bar S.A.S.' }
const WHATSAPP = '+5493515551234'

function render(props: {
  transfer: { alias: string; holder: string | null } | null
  whatsapp: string | null
  holdOver?: boolean
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

function renderPage(
  changes: Partial<PublicOrder>,
  props: { transfer: typeof ACCOUNT | null; whatsapp: string | null },
) {
  return renderToString(
    <OrderView
      order={{ ...order, ...changes }}
      tenantSlug="mi-bar"
      tenantName="Mi Bar"
      address={null}
      paymentId={null}
      {...props}
    />,
  )
}

describe('RejectedTicket', () => {
  it('con cuenta y WhatsApp: el alias, a quién, cuánto y cómo mandar el comprobante', () => {
    const html = render({ transfer: ACCOUNT, whatsapp: WHATSAPP })
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

  it('con cuenta: la hora del lugar guardado es el plazo para transferir', () => {
    const html = render({ transfer: ACCOUNT, whatsapp: null })
    expect(html).toContain('Transferí antes de las 21:30 y el lugar es tuyo.')
    expect(html).not.toContain('Te guardamos el lugar')
  })

  it('sin cuenta: no ofrece transferir y dice hasta cuándo se guarda el lugar', () => {
    const html = render({ transfer: null, whatsapp: WHATSAPP })
    expect(html).not.toContain('Transferí')
    expect(html).toContain('Te guardamos el lugar hasta las 21:30 hs.')
    expect(html).toContain('Reintentar con Mercado Pago')
    expect(html).toContain('Empezar de nuevo')
  })

  it('pasada la hora: la cuenta sigue, sin plazo y sin volver a Mercado Pago', () => {
    const html = render({ transfer: ACCOUNT, whatsapp: null, holdOver: true })
    expect(html).toContain('mi.bar.pagos')
    expect(html).toContain('Si ya transferiste, no hagas nada. Si no, todavía hay lugar.')
    expect(html).toContain('te confirmamos por WhatsApp')
    expect(html).not.toContain('21:30')
    // El link de Mercado Pago vence con el lugar.
    expect(html).not.toContain('Reintentar con Mercado Pago')
    expect(html).toContain('Empezar de nuevo')
  })

  it('pasada la hora y con WhatsApp: que mande el comprobante', () => {
    const html = render({ transfer: ACCOUNT, whatsapp: WHATSAPP, holdOver: true })
    expect(html).toContain('Si ya transferiste, mandanos el comprobante. Si no, todavía hay lugar.')
    expect(html).toContain('Ya transferí: mandar comprobante')
  })
})

describe('OrderView con el pago rechazado', () => {
  const late = { expired: true, roomLeft: true } as const

  it('antes de la hora: el plazo y Mercado Pago', () => {
    const html = renderPage({}, { transfer: ACCOUNT, whatsapp: null })
    expect(html).toContain('El pago no se aprobó.')
    expect(html).toContain('Transferí antes de las 21:30 y el lugar es tuyo.')
    expect(html).toContain('Reintentar con Mercado Pago')
  })

  it('pasada la hora y con lugar: sigue mostrando la cuenta, no «se venció»', () => {
    const html = renderPage(late, { transfer: ACCOUNT, whatsapp: null })
    expect(html).toContain('El pago no se aprobó.')
    expect(html).toContain('mi.bar.pagos')
    expect(html).toContain('Si ya transferiste, no hagas nada. Si no, todavía hay lugar.')
    expect(html).not.toContain('Se venció el tiempo para pagar')
    expect(html).not.toContain('Reintentar con Mercado Pago')
  })

  it('pasada la hora y sin lugar: se venció, sin la cuenta, y tranquiliza a quien ya transfirió', () => {
    const html = renderPage(
      { expired: true, roomLeft: false },
      { transfer: ACCOUNT, whatsapp: null },
    )
    expect(html).toContain('Se venció el tiempo para pagar')
    expect(html).not.toContain('mi.bar.pagos')
    expect(html).toContain('Si ya transferiste, no hagas nada: cuando nos llegue, te confirmamos.')
    expect(html).toContain('Reservar de nuevo')
  })

  it('sin lugar y con WhatsApp: lo dice el botón del comprobante', () => {
    const html = renderPage(
      { expired: true, roomLeft: false },
      { transfer: ACCOUNT, whatsapp: WHATSAPP },
    )
    expect(html).toContain('Se venció el tiempo para pagar')
    expect(html).toContain('Ya transferí: mandar comprobante')
    expect(html).not.toContain('no hagas nada')
  })

  it('la función ya pasó: no promete confirmar nada', () => {
    const html = renderPage(
      { expired: true, roomLeft: false, date: '2026-11-01' },
      { transfer: ACCOUNT, whatsapp: null },
    )
    expect(html).toContain('Se venció el tiempo para pagar')
    expect(html).not.toContain('Si ya transferiste')
  })

  it('sin cuenta para transferir: se venció como siempre', () => {
    const html = renderPage(late, { transfer: null, whatsapp: null })
    expect(html).toContain('Se venció el tiempo para pagar')
    expect(html).not.toContain('Si ya transferiste')
  })

  it('a medio pagar (no rechazado) y vencido: se venció como siempre', () => {
    const html = renderPage({ ...late, status: 'pending' }, { transfer: ACCOUNT, whatsapp: null })
    expect(html).toContain('Se venció el tiempo para pagar')
    expect(html).not.toContain('Si ya transferiste')
    expect(html).not.toContain('mi.bar.pagos')
  })
})
