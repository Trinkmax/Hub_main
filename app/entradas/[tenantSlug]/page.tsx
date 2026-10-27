import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { getAppUrl } from '@/lib/app-url'
import { parseCatalogFilters, summarizeCatalog } from '@/lib/ticketing/catalog'
import { getPublicCatalog } from '@/lib/ticketing/queries'
import { viewerOwnsTenant } from '@/lib/ticketing/viewer'
import { CarteleraView, DEFAULT_INTRO } from './_components/cartelera-view'

/**
 * La cartelera pública: el link que el bar manda por WhatsApp e Instagram
 * («acá podés ver todo lo que hay y reservar»). Dinámica: los lugares cambian
 * con cada compra y cada reserva que carga el bar.
 */
export const dynamic = 'force-dynamic'

// El dueño ve también las películas sin publicar (vista previa), marcadas.
const resolveCatalog = cache(async (tenantSlug: string) =>
  getPublicCatalog(tenantSlug, { includeUnpublished: await viewerOwnsTenant(tenantSlug) }),
)

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}): Promise<Metadata> {
  const { tenantSlug } = await params
  const catalog = await resolveCatalog(tenantSlug)
  if (!catalog) return { title: 'Cartelera' }
  const summary = summarizeCatalog(catalog.experiences)
  const headline = catalog.venue.headline ?? summary.series ?? 'Cartelera'
  const title = `${headline} · ${catalog.venue.tenantName}`
  const description = catalog.venue.intro ?? DEFAULT_INTRO
  const appUrl = await getAppUrl()
  const image = catalog.experiences.find((e) => e.posterUrl)?.posterUrl ?? null
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: `${appUrl}/entradas/${tenantSlug}` },
    openGraph: {
      title,
      description,
      url: `${appUrl}/entradas/${tenantSlug}`,
      siteName: catalog.venue.tenantName,
      type: 'website',
      images: image ? [{ url: image, alt: headline }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: image ? [image] : undefined,
    },
  }
}

export default async function CarteleraPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<{
    mes?: string | string[]
    pelicula?: string | string[]
    ver?: string | string[]
  }>
}) {
  const [{ tenantSlug }, sp] = await Promise.all([params, searchParams])
  const catalog = await resolveCatalog(tenantSlug)
  if (!catalog) notFound()
  // Un link puede llegar ya filtrado (?ver=disponibles): se arma así desde el server.
  return <CarteleraView catalog={catalog} filters={parseCatalogFilters(sp)} />
}
