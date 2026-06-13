import { MessageSquare, Settings2 } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { requireFeature } from '@/lib/platform/guards'
import { getReviewInsights, listReviews } from '@/lib/reviews/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { ReviewsInsights } from './_components/reviews-insights'
import { ReviewsList } from './_components/reviews-list'

export const metadata = { title: 'Reseñas' }

export default async function ReviewsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params

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

  const [insights, reviews] = await Promise.all([
    getReviewInsights(access.tenant.id),
    listReviews({ tenantId: access.tenant.id }),
  ])

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

      {reviews.length === 0 ? (
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
          <ReviewsInsights insights={insights} />
          <section className="space-y-3">
            <h2 className="font-serif text-xl font-semibold tracking-tight">Últimas reseñas</h2>
            <ReviewsList reviews={reviews} />
          </section>
        </>
      )}
    </main>
  )
}
