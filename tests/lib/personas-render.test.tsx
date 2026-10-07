// @vitest-environment node
import type * as React from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CustomersTable } from '@/app/(manager)/[tenantSlug]/clientes/_components/customers-table'
import { LedgerTab } from '@/app/(manager)/[tenantSlug]/clientes/[id]/_components/ledger-tab'
import { ReviewsTab } from '@/app/(manager)/[tenantSlug]/clientes/[id]/_components/reviews-tab'
import { VisitsTab } from '@/app/(manager)/[tenantSlug]/clientes/[id]/_components/visits-tab'
import { ReviewsFilters } from '@/app/(manager)/[tenantSlug]/reviews/_components/reviews-filters'
import { ReviewsInsights } from '@/app/(manager)/[tenantSlug]/reviews/_components/reviews-insights'
import { ReviewsList } from '@/app/(manager)/[tenantSlug]/reviews/_components/reviews-list'
import type { CustomerListRow } from '@/lib/customers/queries'

/**
 * Lote Personas del kit HUB (clientes y reseñas): lo que sale en el HTML del
 * server. Listas en `DataTable` (filas-link, sin `<table>` a mano, tarjetas
 * del celular), plata y puntos con el signo tipográfico, estados con texto,
 * filtros por link con `aria-current` y nada por debajo de 12 px.
 */

vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>()
  return { ...actual, usePathname: () => '/hub/reviews' }
})

const html = (node: React.ReactElement) => renderToString(node)
const textOf = (markup: string) =>
  markup
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    // Solo espacios comunes: el espacio duro (U+00A0) de «60 %» es parte del formato.
    .replace(/[ \t\r\n]+/g, ' ')

/** Las etiquetas `<a …>` del HTML, para mirar sus atributos sin depender del orden. */
const anchors = (markup: string) => markup.match(/<a\b[^>]*>/g) ?? []
const anchorWith = (markup: string, ...attrs: string[]) =>
  anchors(markup).filter((tag) => attrs.every((attr) => tag.includes(attr)))

/** Ninguna clase de texto de 9, 10 u 11 px (§7.b): el mínimo del kit es 12. */
function expectNoMicroText(markup: string) {
  expect(markup).not.toMatch(/text-\[(9|10|11)px\]/)
}

const ROW: CustomerListRow = {
  id: 'c-1',
  phone: '+5493515551234',
  first_name: 'Melina',
  last_name: 'Gómez',
  last_visit_at: null,
  points_balance: 1200,
  total_visits: 3,
  created_at: '2026-01-01T12:00:00Z',
  tags: [{ id: 't-1', name: 'VIP', color: '#c2410c' }],
}

describe('Clientes', () => {
  it('la lista es una DataTable con filas que llevan a la ficha', () => {
    const markup = html(<CustomersTable rows={[ROW]} tenantSlug="hub" />)
    expect(markup.match(/<table/g)).toHaveLength(1)
    expect(markup).toContain('data-slot="data-table"')
    expect(markup).toContain('href="/hub/clientes/c-1"')
    // Tarjetas para el celular (doble marcado por CSS).
    expect(markup).toContain('data-slot="data-table-cards"')
    const text = textOf(markup)
    expect(text).toContain('+54 9 351 555-1234')
    expect(text).toContain('3 visitas')
    expect(text).toContain('1.200')
    expect(text).toContain('Sin visitas todavía')
    expect(text).toContain('VIP')
    expectNoMicroText(markup)
  })

  it('la lista vacía muestra el vacío que le pasa la página', () => {
    const markup = html(
      <CustomersTable rows={[]} tenantSlug="hub" empty={<p>Todavía no hay clientes</p>} />,
    )
    expect(textOf(markup)).toContain('Todavía no hay clientes')
  })

  it('visitas: fecha en hora de Córdoba, total en pesos y la reseña marcada', () => {
    const markup = html(
      <VisitsTab
        visits={[
          {
            id: 'v-1',
            visited_at: '2026-10-07T02:30:00Z',
            total_amount_cents: 1250000,
            notes: null,
            source: 'cashier',
          },
        ]}
        reviewedVisits={{ 'v-1': 4 }}
      />,
    )
    const text = textOf(markup)
    expect(text).toContain('06/10/2026 23:30')
    expect(text).toContain('12.500')
    expect(text).toContain('Dejó una reseña de 4 de 5 estrellas')
    expect(text).toContain('Caja')
    expectNoMicroText(markup)
  })

  it('puntos: signo siempre a la vista (− tipográfico) y estado del canje con texto', () => {
    const markup = html(
      <LedgerTab
        balance={340}
        ledger={[
          {
            id: 'l-1',
            delta: 10,
            reason: 'rule_engine',
            payload: [{ description: '1 punto cada $ 100' }] as unknown as Record<string, unknown>,
            created_at: '2026-10-01T20:00:00Z',
            visit_id: 'v-1',
            redemption_id: null,
          },
          {
            id: 'l-2',
            delta: -5,
            reason: 'reward_redeem',
            payload: { reward_name: 'Café' },
            created_at: '2026-10-02T20:00:00Z',
            visit_id: null,
            redemption_id: 'r-1',
          },
        ]}
        redemptions={[
          {
            id: 'r-1',
            reward_id: 'rw-1',
            reward_name: 'Café',
            points_spent: 5,
            redeemed_at: '2026-10-02T20:00:00Z',
            status: 'pending',
          },
        ]}
      />,
    )
    const text = textOf(markup)
    expect(text).toContain('+10')
    expect(text).toContain('−5')
    expect(text).toContain('Visita · 1 punto cada $ 100')
    expect(text).toContain('Canje · Café')
    expect(text).toContain('Por entregar')
    expect(text).toContain('Saldo: 340 pts')
    expect(markup.match(/<table/g)).toHaveLength(2)
  })

  it('reseñas de la ficha: el comentario manda y las malas se destacan sin borde de color', () => {
    const markup = html(
      <ReviewsTab
        reviews={[
          {
            id: 'rv-1',
            rating: 2,
            comment: 'Tardaron mucho',
            source: 'wallet',
            createdAt: '2026-10-01T23:00:00Z',
            visitId: null,
            redirectedToMaps: false,
          },
        ]}
      />,
    )
    expect(markup).toContain('aria-label="2 de 5 estrellas"')
    expect(markup).not.toContain('border-l-2')
    expect(textOf(markup)).toContain('Tardaron mucho')
    expectNoMicroText(markup)
  })
})

describe('Reseñas', () => {
  const insights = {
    total: 10,
    average: 4.25,
    fiveStarPct: 60,
    distribution: { 5: 6, 4: 2, 3: 1, 2: 1, 1: 0 },
  } as const

  it('los números quietos en un KPIGroup y la distribución con links al filtro', () => {
    const markup = html(<ReviewsInsights tenantSlug="hub" insights={insights} active={2} />)
    expect(markup).toContain('data-slot="kpi-group"')
    const text = textOf(markup)
    expect(text).toContain('4,3')
    expect(text).toContain('60 %')
    // La barra activa vuelve a «todas»; las otras filtran.
    expect(anchorWith(markup, 'href="/hub/reviews"', 'aria-current="page"')).toHaveLength(1)
    expect(anchorWith(markup, 'href="/hub/reviews?rating=5"')).toHaveLength(1)
    expectNoMicroText(markup)
  })

  it('el filtro por estrellas es un segmentado de links con aria-current', () => {
    const markup = html(<ReviewsFilters tenantSlug="hub" insights={insights} active={5} />)
    expect(markup).toContain('data-slot="segmented-control"')
    expect(anchorWith(markup, 'href="/hub/reviews?rating=5"', 'aria-current="page"')).toHaveLength(
      1,
    )
    expect(anchorWith(markup, 'aria-current="page"')).toHaveLength(1)
    expect(textOf(markup)).toContain('Todas')
  })

  it('la lista: link a la ficha si hay cliente, «Anónimo» si no', () => {
    const markup = html(
      <ReviewsList
        tenantSlug="hub"
        reviews={[
          {
            id: 'a',
            rating: 5,
            comment: 'Excelente',
            createdAt: '2026-10-01T23:00:00Z',
            redirectedToMaps: true,
            customerId: 'c-1',
            customerName: 'Melina Gómez',
          },
          {
            id: 'b',
            rating: 3,
            comment: null,
            createdAt: '2026-10-02T12:00:00Z',
            redirectedToMaps: false,
            customerId: null,
            customerName: null,
          },
        ]}
      />,
    )
    expect(markup).toContain('href="/hub/clientes/c-1"')
    const text = textOf(markup)
    expect(text).toContain('Fue a Google Maps')
    expect(text).toContain('Anónimo')
    expect(text).toContain('Sin comentario')
    expect(markup).not.toContain('<main')
    expectNoMicroText(markup)
  })
})
