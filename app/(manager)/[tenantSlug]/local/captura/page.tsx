import { QrCode } from 'lucide-react'
import { notFound } from 'next/navigation'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { getAppUrl } from '@/lib/app-url'
import { listCaptureLinks } from '@/lib/customers/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { LinkRow } from './_components/link-row'
import { NewLinkForm } from './_components/new-link-form'

export const metadata = { title: 'Captura' }

export default async function CapturaConfigPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
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

  const links = await listCaptureLinks({ tenantId: access.tenant.id })
  const appUrl = await getAppUrl()

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Club de beneficios"
        title="QR para unirse al club"
        description="Generá el QR que tus mozos muestran para invitar a los clientes a unirse al club. Lo escanean y cargan sus datos solos."
      />

      <div className="card-hairline rounded-xl border bg-card p-5">
        <h2 className="font-display text-sm font-semibold tracking-tight">Nuevo link de captura</h2>
        <p className="text-xs text-muted-foreground">
          Cada link genera un QR único. Imprimilo y ponelo en mesas, barra o stickers.
        </p>
        <div className="mt-4">
          <NewLinkForm tenantSlug={tenantSlug} />
        </div>
      </div>

      <section className="space-y-3">
        <header className="flex items-center justify-between gap-2">
          <h2 className="font-display text-sm font-semibold tracking-tight">
            Links activos <span className="text-muted-foreground">({links.length})</span>
          </h2>
        </header>

        {links.length === 0 ? (
          <EmptyState
            icon={QrCode}
            title="Aún no creaste ningún link"
            description="Empezá generando un QR para tus mesas. Cuando los clientes lo escaneen, se cargan automáticamente en tu base."
          />
        ) : (
          <div className="card-hairline divide-y divide-border/60 overflow-hidden rounded-xl border bg-card">
            {links.map((link) => (
              <LinkRow key={link.id} link={link} tenantSlug={tenantSlug} appUrl={appUrl} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
