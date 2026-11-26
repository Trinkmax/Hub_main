import type { Metadata } from 'next'
import { CartaFrame, cartaMetadata, loadCarta } from '../_lib/carta-page'
import { CartaExperience } from './_components/carta-experience'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}): Promise<Metadata> {
  const { tenantSlug } = await params
  return cartaMetadata(tenantSlug, { preview: true })
}

/**
 * La carta nueva (`docs/features/carta-rediseno.md`), en su propia dirección: para verla y seguir
 * trabajándola mientras los clientes siguen con la de siempre en `/carta/<bar>`.
 */
export default async function CartaNuevaPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<{ club?: string; wallet?: string }>
}) {
  const { tenantSlug } = await params
  const data = await loadCarta(tenantSlug, await searchParams)

  return (
    <CartaFrame data={data}>
      <CartaExperience
        tenantName={data.tenant.name}
        logoUrl={data.tenant.logoUrl}
        tree={data.tree}
        tenantSlug={tenantSlug}
        captureLinkSlug={data.captureLinkSlug}
        walletContent={data.walletContent}
        walletSummary={data.walletSummary}
        initialSheet={data.initialSheet}
        sponsors={data.sponsors}
        daypart={data.daypart}
      />
    </CartaFrame>
  )
}
