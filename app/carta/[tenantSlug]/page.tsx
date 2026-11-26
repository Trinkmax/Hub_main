import type { Metadata } from 'next'
import nextDynamic from 'next/dynamic'
import { CartaExperience } from './_components/carta-experience'
import { CartaFrame, cartaMetadata, loadCarta } from './_lib/carta-page'

export const dynamic = 'force-dynamic'

// La carta nueva solo se baja en esta dirección si el bar la tiene prendida («Carta nueva»): mientras
// tanto, quien abre la de siempre no carga con su código.
const CartaNueva = nextDynamic(() =>
  import('./nueva/_components/carta-experience').then((module) => module.CartaExperience),
)

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}): Promise<Metadata> {
  const { tenantSlug } = await params
  return cartaMetadata(tenantSlug)
}

/**
 * La carta del bar: la dirección del QR. Muestra la de siempre, o la nueva si el bar tiene prendido el
 * interruptor «Carta nueva» (`docs/features/carta-rediseno.md`).
 */
export default async function CartaPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<{ club?: string; wallet?: string }>
}) {
  const { tenantSlug } = await params
  const data = await loadCarta(tenantSlug, await searchParams)
  const shared = {
    tenantName: data.tenant.name,
    logoUrl: data.tenant.logoUrl,
    tree: data.tree,
    tenantSlug,
    captureLinkSlug: data.captureLinkSlug,
    walletContent: data.walletContent,
    walletSummary: data.walletSummary,
    initialSheet: data.initialSheet,
    sponsors: data.sponsors,
  }

  return (
    <CartaFrame data={data}>
      {data.nuevaParaTodos ? (
        <CartaNueva {...shared} daypart={data.daypart} />
      ) : (
        <CartaExperience {...shared} />
      )}
    </CartaFrame>
  )
}
