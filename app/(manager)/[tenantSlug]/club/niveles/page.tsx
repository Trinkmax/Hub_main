import { Info } from 'lucide-react'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import type { TierBenefit } from '@/lib/points/benefits'
import { listActiveRewards, listPartners, listTierBenefits, listTiers } from '@/lib/points/queries'
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

  // Niveles + sus beneficios + recompensas activas (para `recurring_reward`)
  // + marcas aliadas (para `partner`).
  const [tiers, benefits, rewards, partners] = await Promise.all([
    listTiers({ tenantId: access.tenant.id }),
    listTierBenefits({ tenantId: access.tenant.id }),
    listActiveRewards({ tenantId: access.tenant.id }),
    listPartners({ tenantId: access.tenant.id }),
  ])

  // Agrupar beneficios por nivel para pasarlos ya listos a la lista.
  const benefitsByTier: Record<string, TierBenefit[]> = {}
  for (const b of benefits) {
    const bucket = benefitsByTier[b.tier_id] ?? []
    bucket.push(b)
    benefitsByTier[b.tier_id] = bucket
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Club de beneficios"
        title="Niveles del club"
        description="Los niveles se calculan por PUNTOS DE CATEGORÍA: la suma de puntos ganados en los últimos 4 meses. Suben y bajan con la actividad reciente."
      />

      <div className="card-hairline flex items-start gap-3 rounded-xl border border-border/70 bg-primary/5 p-4 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div className="space-y-0.5">
          <p className="font-medium text-foreground">Cómo funcionan los niveles</p>
          <p className="text-xs text-muted-foreground text-pretty">
            El nivel de cada cliente mira sus <strong>puntos de categoría</strong>: la suma móvil de
            lo que ganó en los últimos 4 meses. Si sigue activo, sube; si deja de venir, baja. Cada
            nivel puede desbloquear beneficios (ítems gratis recurrentes, descuentos, perks o marcas
            aliadas) desde el botón{' '}
            <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px]">
              Beneficios
            </span>{' '}
            de cada fila.
          </p>
        </div>
      </div>

      <TiersList
        tenantSlug={tenantSlug}
        tiers={tiers}
        benefitsByTier={benefitsByTier}
        rewards={rewards}
        partners={partners}
      />
    </div>
  )
}
