import { Info } from 'lucide-react'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { listActiveRewards, listTiers } from '@/lib/points/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { TiersList } from '../_components/tiers-list'

export const metadata = { title: 'Niveles del club' }

export default async function NivelesPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
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

  // Niveles + recompensas activas (estas últimas alimentan el selector de
  // beneficio recurrente en el formulario).
  const [tiers, rewards] = await Promise.all([
    listTiers({ tenantId: access.tenant.id }),
    listActiveRewards({ tenantId: access.tenant.id }),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Club de beneficios"
        title="Niveles del club"
        description="Los niveles se alcanzan por puntos acumulados de por vida —nunca bajan, aunque el cliente canjee. Cada nivel puede desbloquear recompensas exclusivas y un beneficio recurrente automático."
      />

      <div className="card-hairline flex items-start gap-3 rounded-xl border border-border/70 bg-primary/5 p-4 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div className="space-y-0.5">
          <p className="font-medium text-foreground">Cómo funcionan los niveles</p>
          <p className="text-xs text-muted-foreground text-pretty">
            Un cliente sube de nivel a medida que suma puntos por sus consumos. Mientras un canje le
            descuenta puntos gastables, su <strong>nivel</strong> mira los puntos acumulados de por
            vida: subir es para siempre. Asigná recompensas exclusivas por nivel desde{' '}
            <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px]">
              Puntos y recompensas
            </span>
            .
          </p>
        </div>
      </div>

      <TiersList tenantSlug={tenantSlug} tiers={tiers} rewards={rewards} />
    </div>
  )
}
