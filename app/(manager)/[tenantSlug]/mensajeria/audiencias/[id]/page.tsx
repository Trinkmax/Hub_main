import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { getAudience, getAudienceBuilderOptions } from '@/lib/audiences/queries'
import type { AudienceFilter } from '@/lib/audiences/schemas'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { AudienceForm } from '../_components/audience-form'

export const metadata = { title: 'Editar audiencia' }
export const dynamic = 'force-dynamic'

export default async function EditAudiencePage({
  params,
}: {
  params: Promise<{ tenantSlug: string; id: string }>
}) {
  const { tenantSlug, id } = await params
  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const [audience, options] = await Promise.all([
    getAudience(access.tenant.id, id),
    getAudienceBuilderOptions(access.tenant.id),
  ])
  if (!audience) notFound()

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href={`/${tenantSlug}/mensajeria/audiencias`}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3" />
        Volver a audiencias
      </Link>
      <PageHeader
        eyebrow="Mensajería"
        title="Editar audiencia"
        description={`${audience.customer_count_cached.toLocaleString('es-AR')} ${
          audience.customer_count_cached === 1 ? 'cliente' : 'clientes'
        } en el último conteo. Si cambiás las condiciones, el número se actualiza solo.`}
      />
      <AudienceForm
        tenantSlug={tenantSlug}
        options={options}
        audienceId={audience.id}
        initialName={audience.name}
        initialFilters={audience.filters as unknown as AudienceFilter}
      />
    </div>
  )
}
