import { Info } from 'lucide-react'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { listPartners } from '@/lib/points/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { PartnersManager } from './_components/partners-manager'

export const metadata = { title: 'Marcas aliadas' }

export default async function AliadosPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params

  // Owner-only: 404 si no es owner para no revelar la existencia de la ruta.
  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const partners = await listPartners({ tenantId: access.tenant.id })

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Club de beneficios"
        title="Marcas aliadas"
        description="Descuentos de comercios amigos que sumás a los beneficios del club. Tus clientes los ven junto a los perks de su nivel y los aprovechan mostrando su credencial."
      />

      <div className="card-hairline flex items-start gap-3 rounded-xl border border-border/70 bg-primary/5 p-4 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div className="space-y-0.5">
          <p className="font-medium text-foreground">Antes de mostrarla al cliente</p>
          <p className="text-xs text-muted-foreground text-pretty">
            Las marcas inactivas no se muestran a los clientes. Activá cada una cuando cierres el
            acuerdo y cargues su logo.
          </p>
        </div>
      </div>

      <PartnersManager tenantSlug={tenantSlug} partners={partners} />
    </div>
  )
}
