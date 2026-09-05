import { notFound } from 'next/navigation'
import { getAppUrl } from '@/lib/app-url'
import { getLandingPage, getLandingViewSeries, listLandingVersions } from '@/lib/landings/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { LandingEditor } from './_components/landing-editor'

export const metadata = { title: 'Editar página' }

// El editor arranca con lo último guardado, siempre.
export const dynamic = 'force-dynamic'

export default async function EditarPaginaPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; pageId: string }>
}) {
  const { tenantSlug, pageId } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const page = await getLandingPage(access.tenant.id, pageId)
  if (!page) notFound()

  const [versions, views, appUrl] = await Promise.all([
    listLandingVersions(access.tenant.id, page.id),
    getLandingViewSeries(access.tenant.id, page.id),
    getAppUrl(),
  ])

  return (
    <LandingEditor
      tenantSlug={tenantSlug}
      tenantId={access.tenant.id}
      page={page}
      versions={versions}
      views={views}
      appUrl={appUrl}
    />
  )
}
