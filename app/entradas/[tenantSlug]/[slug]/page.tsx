import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { getAppUrl } from '@/lib/app-url'
import { formatPesos } from '@/lib/ticketing/pricing'
import { getPublicExperience } from '@/lib/ticketing/queries'
import { viewerOwnsTenant } from '@/lib/ticketing/viewer'
import { ExperienceView } from './_components/experience-view'

/**
 * La página de una película: se cuenta como una función de cine, en actos
 * (la noche, el menú, las escenas, cómo se vive) y termina en «Tu entrada»,
 * donde se paga. En la compu la entrada acompaña toda la lectura en una
 * columna fija; en el celular está al final y una barra la tiene a mano.
 */
export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const resolvePage = cache(async (tenantSlug: string, slug: string) => {
  const page = await getPublicExperience(tenantSlug, slug)
  if (page) return page
  // Solo si no está publicada (o no existe) se pregunta quién mira: el dueño
  // la ve igual (vista previa); el resto, 404.
  if (!(await viewerOwnsTenant(tenantSlug))) return null
  return getPublicExperience(tenantSlug, slug, { allowUnpublished: true })
})

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string; slug: string }>
}): Promise<Metadata> {
  const { tenantSlug, slug } = await params
  const page = await resolvePage(tenantSlug, slug)
  if (!page) return { title: 'Película' }
  const { experience, venue } = page
  const title = `${experience.title}${experience.series ? ` · ${experience.series}` : ''} · ${venue.tenantName}`
  const from = experience.depositCents > 0 ? experience.depositCents : experience.priceCents
  const description =
    experience.tagline ??
    `Película en pantalla grande y degustación. Reservá desde ${formatPesos(from)} por persona.`
  const appUrl = await getAppUrl()
  const url = `${appUrl}/entradas/${tenantSlug}/${experience.slug}`
  const image = experience.heroUrl ?? experience.posterUrl
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    robots: page.preview ? { index: false, follow: false } : undefined,
    openGraph: {
      title,
      description,
      url,
      siteName: venue.tenantName,
      type: 'website',
      images: image ? [{ url: image, alt: experience.title }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: image ? [image] : undefined,
    },
  }
}

export default async function ExperiencePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; slug: string }>
  searchParams: Promise<{ fecha?: string | string[] }>
}) {
  const [{ tenantSlug, slug }, sp] = await Promise.all([params, searchParams])
  const page = await resolvePage(tenantSlug, slug)
  if (!page) notFound()
  const fecha = typeof sp.fecha === 'string' && DATE_RE.test(sp.fecha) ? sp.fecha : null
  return <ExperienceView page={page} fecha={fecha} />
}
