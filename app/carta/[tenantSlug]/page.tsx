import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import QRCode from 'qrcode'
import { WalletShell } from '@/app/c/[token]/_components/wallet-shell'
import { BrandAccent } from '@/components/theme/brand-accent-provider'
import { getAppUrl } from '@/lib/app-url'
import { getCanonicalCaptureLink } from '@/lib/capture/canonical'
import { walletCookieName } from '@/lib/capture/cookie'
import { listActiveMenuPublic } from '@/lib/menu/queries'
import { buildCategoryTree } from '@/lib/menu/tree'
import { createServiceClient } from '@/lib/supabase/service'
import { getWalletByToken, type WalletData } from '@/lib/wallet/queries'
import { CartaExperience } from './_components/carta-experience'

export const dynamic = 'force-dynamic'

type TenantRow = {
  id: string
  name: string
  logo_url: string | null
  brand_accent: string | null
}

async function resolveTenant(slug: string): Promise<TenantRow | null> {
  const service = createServiceClient()
  const { data } = await service
    .from('tenants')
    .select('id, name, logo_url, brand_accent')
    .eq('slug', slug)
    .maybeSingle()
  return (data as TenantRow | null) ?? null
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}): Promise<Metadata> {
  const { tenantSlug } = await params
  const tenant = await resolveTenant(tenantSlug)
  if (!tenant) return { title: 'Carta' }
  return {
    title: `Carta · ${tenant.name}`,
    description: `La carta de ${tenant.name}.`,
  }
}

/** Lee la cookie de identidad y devuelve la wallet sólo si es del mismo tenant. */
async function resolveWallet(tenantId: string): Promise<WalletData | null> {
  const store = await cookies()
  const token = store.get(walletCookieName(tenantId))?.value
  if (!token) return null
  const wallet = await getWalletByToken(token)
  if (!wallet || wallet.tenant.id !== tenantId) return null
  return wallet
}

export default async function CartaPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<{ club?: string; wallet?: string }>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const tenant = await resolveTenant(tenantSlug)
  if (!tenant) notFound()

  const [{ categories, items }, wallet, captureLinkSlug] = await Promise.all([
    listActiveMenuPublic({ tenantId: tenant.id }),
    resolveWallet(tenant.id),
    getCanonicalCaptureLink(tenant.id),
  ])
  const tree = buildCategoryTree(categories, items)

  let walletContent: React.ReactNode = null
  if (wallet) {
    const appUrl = await getAppUrl()
    const qrDataUrl = await QRCode.toDataURL(`${appUrl}/c/${wallet.customer.qrToken}`, {
      width: 360,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    })
    walletContent = <WalletShell data={wallet} qrDataUrl={qrDataUrl} embedded />
  }

  // Resumen serializable para el header del sheet (logo, saludo, nivel).
  const walletSummary = wallet
    ? {
        tenantName: wallet.tenant.name,
        logoUrl: wallet.tenant.logoUrl,
        firstName: wallet.customer.firstName,
        tierName: wallet.tier.current?.name ?? null,
        tierColor: wallet.tier.current?.color ?? null,
      }
    : null

  const wantsClub = sp.club != null
  const wantsWallet = sp.wallet != null
  const initialSheet: 'none' | 'club' | 'wallet' =
    wantsWallet && wallet ? 'wallet' : wantsClub ? (wallet ? 'wallet' : 'club') : 'none'

  // Las fotos/videos vienen de Supabase Storage: preconnect para ahorrar el
  // handshake TLS en la primera imagen. React 19 hoistea los <link> al <head>.
  let storageOrigin: string | null = null
  try {
    storageOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').origin
  } catch {
    storageOrigin = null
  }

  return (
    <BrandAccent accent={tenant.brand_accent} className="force-light min-h-[100dvh] bg-background">
      {storageOrigin ? (
        <>
          <link rel="preconnect" href={storageOrigin} />
          <link rel="dns-prefetch" href={storageOrigin} />
        </>
      ) : null}
      <CartaExperience
        tenantName={tenant.name}
        logoUrl={tenant.logo_url}
        tree={tree}
        tenantSlug={tenantSlug}
        captureLinkSlug={captureLinkSlug}
        walletContent={walletContent}
        walletSummary={walletSummary}
        initialSheet={initialSheet}
      />
    </BrandAccent>
  )
}
