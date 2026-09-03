import type { Metadata, Viewport } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { LinkPageView } from '@/components/public-links/link-page-view'
import { BrandAccent } from '@/components/theme/brand-accent-provider'
import { getAppUrl } from '@/lib/app-url'
import { getPublicLinkPageBySlug } from '@/lib/public-links/queries'

/**
 * La página del link de la bio de Instagram. Pública, sin sesión.
 *
 * `force-dynamic` porque el dueño edita los botones desde el panel y espera
 * verlos al toque en el celular; además el render resuelve el tenant por slug
 * en cada request (nada que prerenderizar en build).
 */
export const dynamic = 'force-dynamic'

// Light-only: la página es la vitrina del bar. Con el par light/dark del root
// layout, un celular en modo oscuro pintaba la barra de estado verde noche
// arriba de un panel crema.
export const viewport: Viewport = {
  themeColor: '#f5edd7',
  width: 'device-width',
  initialScale: 1,
}

// `cache` de React: generateMetadata y la page piden lo mismo en el mismo
// request; sin esto son dos rondas idénticas a Supabase por render.
const resolvePage = cache(getPublicLinkPageBySlug)

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}): Promise<Metadata> {
  const { tenantSlug } = await params
  const data = await resolvePage(tenantSlug)
  if (!data?.page.active) return { title: 'Link no disponible' }

  const title = data.page.headline?.trim() || data.tenant.name
  const description = data.page.bio ?? `Todos los links de ${data.tenant.name}.`
  const appUrl = await getAppUrl()
  const url = `${appUrl}/l/${tenantSlug}`
  // El logo tiene que viajar ABSOLUTO: WhatsApp y Telegram no resuelven paths
  // relativos al pedir la miniatura. Esta página nace para ser compartida —
  // sin `og:image` el preview sale como una tira gris y nadie la toca.
  const image = data.tenant.logoUrl
    ? data.tenant.logoUrl.startsWith('http')
      ? data.tenant.logoUrl
      : `${appUrl}${data.tenant.logoUrl}`
    : null

  return {
    // `absolute` para escapar del template global "%s · HUB": esta página es
    // del bar, no de la plataforma.
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: data.tenant.name,
      type: 'website',
      images: image ? [{ url: image, alt: data.tenant.name }] : undefined,
    },
    twitter: { card: 'summary', title, description, images: image ? [image] : undefined },
    robots: { index: true, follow: true },
  }
}

export default async function PublicLinksPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const data = await resolvePage(tenantSlug)
  if (!data?.page.active) notFound()

  return (
    <BrandAccent
      accent={data.tenant.brandAccent}
      className="force-light min-h-[100dvh] bg-background"
    >
      <LinkPageView
        tenantName={data.tenant.name}
        headline={data.page.headline}
        bio={data.page.bio}
        logoUrl={data.tenant.logoUrl}
        links={data.links}
        className="min-h-[100dvh]"
      />
    </BrandAccent>
  )
}
