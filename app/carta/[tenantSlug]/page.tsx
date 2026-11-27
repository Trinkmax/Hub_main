import type { Metadata } from 'next'
import nextDynamic from 'next/dynamic'
import { BranchPicker } from './_components/branch-picker'
import { CartaExperience } from './_components/carta-experience'
import {
  CartaFrame,
  CartaPickerFrame,
  type CartaSearchParams,
  cartaMetadata,
  loadCarta,
  resolveCarta,
} from './_lib/carta-page'

export const dynamic = 'force-dynamic'

// La carta nueva solo se baja en esta dirección si el bar la tiene prendida («Carta nueva»): mientras
// tanto, quien abre la de siempre no carga con su código.
const CartaNueva = nextDynamic(() =>
  import('./nueva/_components/carta-experience').then((module) => module.CartaExperience),
)

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<CartaSearchParams>
}): Promise<Metadata> {
  const { tenantSlug } = await params
  const { sucursal } = await searchParams
  return cartaMetadata(tenantSlug, { sucursal })
}

/**
 * La carta del bar: la dirección del QR. Si el bar tiene dos o más sucursales, primero se elige la
 * sucursal y cada una muestra su carta (`?sucursal=<slug>`, docs/features/carta-por-sucursal.md).
 * Muestra la de siempre, o la nueva si el bar tiene prendido el interruptor «Carta nueva»
 * (`docs/features/carta-rediseno.md`).
 */
export default async function CartaPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<CartaSearchParams>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const entry = await resolveCarta(tenantSlug, sp)

  if (entry.kind === 'picker') {
    const { tenant, branches } = entry.data
    return (
      <CartaPickerFrame brandAccent={tenant.brandAccent}>
        <BranchPicker tenantName={tenant.name} logoUrl={tenant.logoUrl} branches={branches} />
      </CartaPickerFrame>
    )
  }

  const data = await loadCarta(tenantSlug, sp, entry)
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
        <CartaExperience {...shared} branch={data.branch} />
      )}
    </CartaFrame>
  )
}
