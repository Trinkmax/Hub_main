import { MessageSquare, Settings2, Star } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { requireFeature } from '@/lib/platform/guards'
import { getReviewInsights, listReviews } from '@/lib/reviews/queries'
import { parseRatingFilter } from '@/lib/reviews/schemas'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { ReviewsFilters } from './_components/reviews-filters'
import { ReviewsInsights } from './_components/reviews-insights'
import { ReviewsList } from './_components/reviews-list'

export const metadata = { title: 'Reseñas' }

export default async function ReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const rating = parseRatingFilter(sp.rating)

  // Owner-only + feature gate. No exponemos la ruta si no corresponde.
  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }
  await requireFeature(access.tenant, 'reviews')

  // Los insights se calculan siempre sobre el total: son el mapa para navegar
  // el filtro, así que no pueden encogerse cuando el filtro está puesto.
  const [insights, reviews] = await Promise.all([
    getReviewInsights(access.tenant.id),
    listReviews({ tenantId: access.tenant.id, rating }),
  ])

  const filterLabel = rating ? `${rating} ${rating === 1 ? 'estrella' : 'estrellas'}` : null

  return (
    <main className="space-y-8 py-6">
      <PageHeader
        eyebrow="Fidelización"
        title="Reseñas"
        description="Lo que opinan tus clientes. Las de 5★ pueden derivarse a Google Maps; el resto queda como feedback privado."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`/${tenantSlug}/configuracion/resenas`}>
              <Settings2 className="size-4" aria-hidden="true" />
              Configurar
            </Link>
          </Button>
        }
      />

      {insights.total === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="Todavía no hay reseñas"
          description="Cuando tus clientes dejen su opinión desde la wallet, vas a verlas acá con sus calificaciones y comentarios."
          action={
            <Button asChild variant="outline">
              <Link href={`/${tenantSlug}/configuracion/resenas`}>Configurar reseñas</Link>
            </Button>
          }
        />
      ) : (
        <>
          <ReviewsInsights tenantSlug={tenantSlug} insights={insights} active={rating} />

          <section className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-serif text-xl font-semibold tracking-tight">
                {filterLabel ? `Reseñas de ${filterLabel}` : 'Últimas reseñas'}
              </h2>
              <p className="text-sm text-muted-foreground tabular-nums">
                {reviews.length.toLocaleString('es-AR')}{' '}
                {reviews.length === 1 ? 'reseña' : 'reseñas'}
              </p>
            </div>

            <ReviewsFilters tenantSlug={tenantSlug} insights={insights} active={rating} />

            {reviews.length === 0 ? (
              <EmptyState
                icon={Star}
                title={`No hay reseñas de ${filterLabel}`}
                description="Probá con otro puntaje o volvé a ver todas las opiniones."
                action={
                  <Button asChild variant="outline">
                    <Link href={`/${tenantSlug}/reviews`}>Ver todas las reseñas</Link>
                  </Button>
                }
              />
            ) : (
              <ReviewsList tenantSlug={tenantSlug} reviews={reviews} />
            )}
          </section>
        </>
      )}
    </main>
  )
}
