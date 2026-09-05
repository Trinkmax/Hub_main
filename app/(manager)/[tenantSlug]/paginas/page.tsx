import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { getAppUrl } from '@/lib/app-url'
import { listLandingPages } from '@/lib/landings/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { NewPageButton } from './_components/new-page-dialog'
import { PagesList } from './_components/pages-list'

export const metadata = { title: 'Páginas' }

// El listado muestra visitas y "última edición": nada que prerenderizar.
export const dynamic = 'force-dynamic'

export default async function PaginasPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const [pages, appUrl] = await Promise.all([listLandingPages(access.tenant.id), getAppUrl()])
  const urlPrefix = `${appUrl.replace(/^https?:\/\//, '')}/p/`

  return (
    <PageShell width="comfortable">
      <PageHeader
        eyebrow="Marketing"
        title="Páginas"
        description="Subí el HTML de una landing y queda publicada en un link propio, listo para mandar por WhatsApp o pegar en una historia."
        actions={<NewPageButton tenantSlug={tenantSlug} urlPrefix={urlPrefix} />}
      />

      <PagesList tenantSlug={tenantSlug} pages={pages} appUrl={appUrl} />
    </PageShell>
  )
}
