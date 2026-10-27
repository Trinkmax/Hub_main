import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { getPublicOrder } from '@/lib/ticketing/queries'
import { orderIdSchema } from '@/lib/ticketing/schemas'
import { TopBar } from '../../../_components/chrome'
import { OrderView } from './_components/order-view'

/**
 * La entrada del cliente: adonde vuelve desde Mercado Pago y el link que
 * guarda. Nunca se indexa (lleva su nombre).
 */
export const dynamic = 'force-dynamic'

const resolveOrder = cache(async (tenantSlug: string, orderId: string) => {
  if (!orderIdSchema.safeParse(orderId).success) return null
  return getPublicOrder(tenantSlug, orderId)
})

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string; orderId: string }>
}): Promise<Metadata> {
  const { tenantSlug, orderId } = await params
  const page = await resolveOrder(tenantSlug, orderId)
  return {
    title: { absolute: page ? `Tu entrada · ${page.order.title}` : 'Tu entrada' },
    robots: { index: false, follow: false },
  }
}

export default async function MiEntradaPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; orderId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ tenantSlug, orderId }, sp] = await Promise.all([params, searchParams])
  const page = await resolveOrder(tenantSlug, orderId)
  if (!page) notFound()

  // Mercado Pago vuelve con ?payment_id= (y collection_id, el mismo número
  // con el nombre viejo).
  const raw = sp.payment_id ?? sp.collection_id
  const paymentId = typeof raw === 'string' && /^\d{1,24}$/.test(raw) ? raw : null

  return (
    <>
      <TopBar venue={page.venue} />
      <main className="ent-hero -mt-[4.5rem] min-h-[100dvh] px-4 pt-28 pb-16">
        <div className="ent-beam" aria-hidden />
        <div
          className="ent-screen-glow"
          aria-hidden
          style={{ '--accent': page.order.accent } as React.CSSProperties}
        />
        <OrderView
          order={page.order}
          tenantSlug={tenantSlug}
          tenantName={page.venue.tenantName}
          address={page.venue.address}
          whatsapp={page.venue.whatsapp}
          paymentId={paymentId}
        />
      </main>
    </>
  )
}
