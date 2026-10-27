// @vitest-environment node
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AdminExperience, AdminOrder } from '@/lib/ticketing/queries'
import type { TicketingSettingsView } from '@/lib/ticketing/types'

/**
 * Marketing › Entradas en el primer paint (SSR): que cada tarjeta se dibuje sin romper con datos
 * reales de forma, y que diga lo que tiene que decir (estados de las ventas, el link para
 * compartir, la guía de Mercado Pago, el editor en pesos).
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/hub/entradas',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

// Fuera de Next no hay loader de imágenes configurado: un <img> alcanza para mirar el HTML.
vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => createElement('img', { src, alt }),
}))

vi.mock('@/lib/ticketing/actions', () => ({
  createExperience: vi.fn(),
  saveExperience: vi.fn(),
  setExperiencePublished: vi.fn(),
  deleteExperience: vi.fn(),
  saveTicketingSettings: vi.fn(),
  connectMercadoPago: vi.fn(),
  disconnectMercadoPago: vi.fn(),
}))

vi.mock('@/lib/landings/media', () => ({ uploadLandingImage: vi.fn() }))

const { CarteleraCard } = await import(
  '@/app/(manager)/[tenantSlug]/entradas/_components/cartelera-card'
)
const { OrdersSection } = await import(
  '@/app/(manager)/[tenantSlug]/entradas/_components/orders-section'
)
const { ExperiencesSection } = await import(
  '@/app/(manager)/[tenantSlug]/entradas/_components/experiences-section'
)
const { MercadoPagoCard } = await import(
  '@/app/(manager)/[tenantSlug]/entradas/_components/mercado-pago-card'
)
const { SettingsSection } = await import(
  '@/app/(manager)/[tenantSlug]/entradas/_components/settings-section'
)
const { ExperienceEditor } = await import(
  '@/app/(manager)/[tenantSlug]/entradas/[experienceId]/_components/experience-editor'
)

const NOW = new Date('2026-10-26T21:00:00.000Z')
const text = (html: string) =>
  html
    // Los separadores de texto de React (`<!-- -->`) no son espacios.
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')

const EXPERIENCE: AdminExperience = {
  id: '6f1c2a54-1b2c-4d5e-8f90-1a2b3c4d5e6f',
  slug: 'shrek',
  title: 'Shrek',
  series: 'Cine y degustación',
  tagline: 'Un ogro y un menú de pantano.',
  synopsis: 'Un ogro, un burro y una princesa.',
  scheduleNote: 'Ingreso 21:00 · Película 21:20',
  posterUrl: null,
  heroUrl: null,
  accent: '#c0573e',
  steps: [{ icon: '🧅', title: 'Cebollas', description: null, label: null }],
  stepsNote: null,
  gallery: [],
  priceCents: 3_500_000,
  depositCents: 500_000,
  cashPriceCents: null,
  minPartySize: 1,
  maxPartySize: 10,
  priceNote: null,
  terms: null,
  functions: [
    {
      eventId: 'e1',
      date: '2026-12-01',
      time: '21:00',
      capacity: 40,
      left: 32,
      state: 'available',
    },
    { eventId: 'e2', date: '2026-12-08', time: '21:00', capacity: 40, left: 0, state: 'sold_out' },
  ],
  published: false,
  templateId: '7f1c2a54-1b2c-4d5e-8f90-1a2b3c4d5e6f',
  templateName: 'Shrek',
  templateColor: '#40ed54',
  sortOrder: 0,
  updatedAt: '2026-10-26T12:00:00Z',
}

function order(over: Partial<AdminOrder>): AdminOrder {
  return {
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

const SETTINGS: TicketingSettingsView = {
  tenant_id: 't1',
  mp_user_id: null,
  mp_nickname: null,
  mp_live: null,
  mp_connected_at: null,
  online_manager_id: null,
  hold_minutes: 15,
  headline: null,
  intro: null,
  venue_address: null,
  contact_whatsapp: null,
  updated_at: null,
}

describe('Tu cartelera', () => {
  it('el link, compartir por WhatsApp sin número y cómo está hoy', () => {
    const html = renderToString(
      createElement(CarteleraCard, {
        publicUrl: 'https://hubbar.com.ar/entradas/hub',
        summary: { published: 2, drafts: 1, onSale: 5, soldOut: 1 },
        canSell: true,
      }),
    )
    expect(html).toContain('href="https://hubbar.com.ar/entradas/hub"')
    const share = encodeURIComponent(
      '¡Hola! Acá podés ver todas las funciones y reservar tu lugar: https://hubbar.com.ar/entradas/hub',
    )
    expect(html).toContain(`href="https://wa.me/?text=${share}"`)
    expect(text(html)).toContain('2 películas publicadas · 5 funciones a la venta · 1 agotada')
    expect(html).not.toContain('Todavía no conectaste Mercado Pago')
  })

  it('sin Mercado Pago avisa que nadie puede comprar', () => {
    const html = renderToString(
      createElement(CarteleraCard, {
        publicUrl: 'https://hubbar.com.ar/entradas/hub',
        summary: { published: 0, drafts: 1, onSale: 0, soldOut: 0 },
        canSell: false,
      }),
    )
    expect(text(html)).toContain('Todavía no conectaste Mercado Pago')
    expect(text(html)).toContain('Ninguna película publicada')
    expect(text(html)).toContain('Tenés una apagada: prendela abajo cuando esté lista.')
  })
})

describe('Ventas online', () => {
  it('cada compra con su estado, su aviso y el link a la reserva', () => {
    const orders = [
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
    ]
    const html = renderToString(
      createElement(OrdersSection, { tenantSlug: 'hub', result: { ok: true, orders }, now: NOW }),
    )
    const t = text(html)
    expect(t).toContain('Pagado')
    expect(t).toContain('Pagando…')
    expect(t).toContain('Sin pagar')
    expect(t).toContain('Sobrecupo')
    expect(t).toContain('Sin fecha: cargá la reserva a mano')
    expect(t).toContain('+54 9 351 555-1234')
    expect(t).toContain('Mar 01 dic 21:00')
    expect(t).toContain('Hoy 17:42')
    expect(html).toContain('href="/hub/reservas/r-1"')
    expect(html).toContain('href="/hub/reservas/nuevo?date=2026-12-15"')
  })

  it('vacío y con error, cada uno con su texto', () => {
    const empty = renderToString(
      createElement(OrdersSection, {
        tenantSlug: 'hub',
        result: { ok: true, orders: [] },
        now: NOW,
      }),
    )
    expect(text(empty)).toContain('Todavía no hubo ventas online')
    const failed = renderToString(
      createElement(OrdersSection, { tenantSlug: 'hub', result: { ok: false }, now: NOW }),
    )
    expect(text(failed)).toContain('No pudimos cargar las ventas')
    expect(text(failed)).toContain('Reintentar')
  })
})

describe('Películas', () => {
  it('la tarjeta: precio en pesos, funciones con Agotado y vista previa si está apagada', () => {
    const html = renderToString(
      createElement(ExperiencesSection, {
        tenantSlug: 'hub',
        experiences: [EXPERIENCE],
        availableTemplates: [],
        defaults: { price: 35000, deposit: 5000 },
      }),
    )
    const t = text(html)
    expect(t).toContain('Shrek')
    expect(t.replace(/\s/g, ' ')).toMatch(/\$\s35\.000 por persona · seña \$\s5\.000/)
    expect(t).toContain('Quedan 32 de 40')
    expect(t).toContain('Agotado')
    expect(t).toContain('Vista previa')
    expect(html).toContain('href="/hub/entradas/6f1c2a54-1b2c-4d5e-8f90-1a2b3c4d5e6f"')
    expect(html).toContain('href="/entradas/hub/shrek"')
    expect(html).toContain('role="switch"')
    expect(html).not.toContain('centavos')
  })

  it('sin películas: explica y ofrece agregar', () => {
    const html = renderToString(
      createElement(ExperiencesSection, {
        tenantSlug: 'hub',
        experiences: [],
        availableTemplates: [{ id: 't1', name: 'Ratatouille', color: '#ed4094' }],
        defaults: null,
      }),
    )
    expect(text(html)).toContain('Todavía no hay películas a la venta')
    expect(text(html)).toContain('Agregar película')
  })
})

describe('Mercado Pago', () => {
  it('sin conectar: por qué, la guía con la dirección de avisos y el formulario', () => {
    const html = renderToString(
      createElement(MercadoPagoCard, {
        tenantSlug: 'hub',
        account: {
          mp_user_id: null,
          mp_nickname: null,
          mp_live: null,
          mp_connected_at: null,
        },
        webhookUrl: 'https://hubbar.com.ar/api/webhooks/mercadopago?t=t1',
      }),
    )
    const t = text(html)
    expect(t).toContain('Sin conectar')
    expect(t).toContain('Crear aplicación')
    expect(t).toContain('Access Token')
    expect(t).toContain('https://hubbar.com.ar/api/webhooks/mercadopago?t=t1')
    expect(html).toContain('type="password"')
    expect(html).toContain('href="https://www.mercadopago.com.ar/developers/panel/app"')
  })

  it('conectada en modo prueba: la cuenta y el aviso, nunca el token', () => {
    const html = renderToString(
      createElement(MercadoPagoCard, {
        tenantSlug: 'hub',
        account: {
          mp_user_id: 123,
          mp_nickname: 'HUBBAR',
          mp_live: false,
          mp_connected_at: '2026-10-26T15:00:00Z',
        },
        webhookUrl: 'https://hubbar.com.ar/api/webhooks/mercadopago?t=t1',
      }),
    )
    const t = text(html)
    expect(t).toContain('Conectado')
    expect(t).toContain('HUBBAR')
    expect(t).toContain('Modo prueba')
    expect(t).toContain('26/10/2026')
    expect(t).toContain('Desconectar')
    expect(html).not.toContain('type="password"')
  })
})

describe('Configuración de la cartelera', () => {
  it('sin configurar arranca abierta, con «Venta online» sin comisión', () => {
    const html = renderToString(
      createElement(SettingsSection, {
        tenantSlug: 'hub',
        settings: SETTINGS,
        managers: [
          { id: '11111111-1111-4111-8111-111111111111', name: 'Luz', commission: true },
          { id: '22222222-2222-4222-8222-222222222222', name: 'Venta online', commission: false },
        ],
      }),
    )
    const t = text(html)
    expect(html).toContain('aria-expanded="true"')
    expect(t).toContain('¿A nombre de quién quedan las reservas online?')
    expect(t).toContain('«Venta online» no cobra comisión')
    expect(t).toContain('15 min')
  })

  it('ya configurada arranca plegada con un resumen', () => {
    const html = renderToString(
      createElement(SettingsSection, {
        tenantSlug: 'hub',
        settings: { ...SETTINGS, headline: 'Cine y degustación', hold_minutes: 20 },
        managers: [],
      }),
    )
    expect(html).toContain('aria-expanded="false"')
    expect(text(html)).toContain('«Cine y degustación» · lugar guardado 20 min')
  })
})

describe('Editor de una película', () => {
  it('arranca con lo guardado, en pesos, y con la cuenta de ejemplo', () => {
    const html = renderToString(
      createElement(ExperienceEditor, {
        tenantSlug: 'hub',
        tenantId: 't1',
        experience: EXPERIENCE,
        publicBase: 'https://hubbar.com.ar/entradas/hub',
      }),
    )
    const t = text(html)
    expect(html).toContain('value="Shrek"')
    expect(html).toContain('value="35.000"')
    expect(html).toContain('value="5.000"')
    expect(html).toContain('value="shrek"')
    expect(html).toContain('value="Cebollas"')
    expect(t.replace(/\s/g, ' ')).toMatch(
      /2 personas: seña \$\s10\.000 hoy y \$\s60\.000 en efectivo, o \$\s70\.000 todo junto/,
    )
    expect(t).toContain('Apagada')
    expect(t).toContain('Vista previa')
    expect(t).toContain('Todo guardado')
    expect(html).toContain('href="/hub/eventos/programados?day=2026-12-01"')
  })
})
