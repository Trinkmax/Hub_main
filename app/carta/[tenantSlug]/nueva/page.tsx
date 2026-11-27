import type { Metadata } from 'next'
import {
  CartaFrame,
  type CartaSearchParams,
  cartaMetadata,
  loadCarta,
  resolveCarta,
} from '../_lib/carta-page'
import { CartaExperience } from './_components/carta-experience'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<CartaSearchParams>
}): Promise<Metadata> {
  const { tenantSlug } = await params
  const { sucursal } = await searchParams
  return cartaMetadata(tenantSlug, { preview: true, sucursal })
}

/**
 * La carta nueva (`docs/features/carta-rediseno.md`), en su propia dirección: para verla y seguir
 * trabajándola mientras los clientes siguen con la de siempre en `/carta/<bar>`. No pasa por el selector
 * de sucursal: con `?sucursal=<slug>` muestra la carta de esa sucursal y, sin él, la del bar entera.
 */
export default async function CartaNuevaPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<CartaSearchParams>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const entry = await resolveCarta(tenantSlug, sp)
  const data = await loadCarta(
    tenantSlug,
    sp,
    entry.kind === 'carta' ? entry : { branch: null, choosable: false },
  )

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
