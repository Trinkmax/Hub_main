import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { listScheduledTemplates } from '@/lib/salon/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { TemplatesEditor } from './_components/templates-editor'

export const metadata = { title: 'Templates de eventos' }
export const dynamic = 'force-dynamic'

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (e) {
    if (e instanceof TenantNotFoundError) notFound()
    if (e instanceof RoleRequiredError) notFound()
    throw e
  }

  const templates = await listScheduledTemplates({
    tenantId: access.tenant.id,
    onlyActive: false,
  })

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={
          <Link
            href={`/${tenantSlug}/eventos/programados`}
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Volver al calendario
          </Link>
        }
        title="Templates de eventos"
        description="Sushi Libre, Pizza Libre, Ramen, etc. — el catálogo de formatos que después se programan en fechas concretas."
      />
      <TemplatesEditor tenantSlug={tenantSlug} initial={templates} />
    </div>
  )
}
