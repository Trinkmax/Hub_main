import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { countReservationsByCakeOption, listCakeOptions } from '@/lib/salon/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { CakeCatalogEditor } from './_components/cake-catalog-editor'

export const metadata = { title: 'Tortas de cumpleaños' }
export const dynamic = 'force-dynamic'

export default async function TortasConfigPage({
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

  const [options, usage] = await Promise.all([
    listCakeOptions({ tenantId: access.tenant.id }),
    countReservationsByCakeOption({ tenantId: access.tenant.id }),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link
            href={`/${tenantSlug}/configuracion`}
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Configuración
          </Link>
        }
        title="Tortas de cumpleaños"
        description="El menú de tortas que hace el bar. Cuando una reserva de cumpleaños marca que lleva torta, quien la carga elige de esta lista — y la cocina sabe cuál hacer."
      />
      <CakeCatalogEditor tenantSlug={tenantSlug} initial={options} usage={usage} />
    </div>
  )
}
