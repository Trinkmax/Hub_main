import { Gift, Info, Star } from 'lucide-react'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { listMenu } from '@/lib/menu/queries'
import { getPointsRedemptionConfig, listRewards, listRules } from '@/lib/points/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { NewPerAmountForm } from './_components/new-per-amount-form'
import { NewPerItemForm } from './_components/new-per-item-form'
import { NewRewardForm } from './_components/new-reward-form'
import { RedemptionConfigForm } from './_components/redemption-config-form'
import { RewardsList } from './_components/rewards-list'
import { RulesList } from './_components/rules-list'

type Rule = {
  id: string
  type: 'per_amount' | 'per_item'
  config: Record<string, unknown>
  priority: number
  active: boolean
}

function describeActivePerAmountRule(rules: Rule[]): string | null {
  const active = rules
    .filter((r) => r.type === 'per_amount' && r.active)
    .sort((a, b) => b.priority - a.priority)[0]
  if (!active) return null
  const everyCents = Number(active.config.every_cents ?? 0)
  const points = Number(active.config.points ?? 0)
  if (!everyCents || !points) return null
  const everyPesos = everyCents / 100
  if (everyPesos === 1 && points === 1) {
    return 'Hoy se acredita 1 punto por cada peso gastado.'
  }
  return `Hoy se acredita ${points} ${
    points === 1 ? 'punto' : 'puntos'
  } por cada $${everyPesos.toLocaleString('es-AR')} gastados.`
}

export const metadata = { title: 'Puntos' }

export default async function PuntosPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
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

  const [rules, rewards, menu, redemptionConfig] = await Promise.all([
    listRules({ tenantId: access.tenant.id }),
    listRewards({ tenantId: access.tenant.id }),
    listMenu({ tenantId: access.tenant.id }),
    getPointsRedemptionConfig(access.tenant.id),
  ])

  const activeRuleSummary = describeActivePerAmountRule(rules as Rule[])
  const perItemRules = (rules as Rule[]).filter((r) => r.type === 'per_item')

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Catálogo"
        title="Puntos y recompensas"
        description="Cómo se ganan los puntos y qué pueden canjear los clientes."
      />

      <RedemptionConfigForm tenantSlug={tenantSlug} initial={redemptionConfig} />

      {activeRuleSummary ? (
        <div className="card-hairline flex items-start gap-3 rounded-xl border bg-primary/5 p-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="space-y-0.5">
            <p className="font-medium text-foreground">{activeRuleSummary}</p>
            <p className="text-xs text-muted-foreground">
              Para clientes con QR personal, el cajero escanea desde
              <span className="mx-1 rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px]">
                Acreditar puntos
              </span>
              e ingresa el monto pagado.
            </p>
          </div>
        </div>
      ) : (
        <div className="card-hairline flex items-start gap-3 rounded-xl border bg-warning/10 p-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="space-y-0.5">
            <p className="font-medium text-foreground">No hay regla de puntos activa todavía.</p>
            <p className="text-xs text-muted-foreground">
              Creá una abajo. Recomendado: 1 punto por cada peso gastado.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-4">
          <header className="flex items-center gap-2">
            <Star className="size-4 text-primary" />
            <h2 className="font-display text-base font-semibold tracking-tight">
              Reglas de puntos
            </h2>
          </header>

          <NewPerAmountForm tenantSlug={tenantSlug} />

          <details className="card-hairline group rounded-xl border bg-card/60 p-4">
            <summary className="cursor-pointer list-none text-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">Reglas avanzadas</p>
                  <p className="text-xs text-muted-foreground">
                    Bonificar puntos extra por ítem o categoría específica
                    {perItemRules.length > 0 ? ` · ${perItemRules.length} activa(s)` : ''}.
                  </p>
                </div>
                <span className="text-xs text-muted-foreground group-open:hidden">Mostrar</span>
                <span className="hidden text-xs text-muted-foreground group-open:inline">
                  Ocultar
                </span>
              </div>
            </summary>
            <div className="mt-4">
              <NewPerItemForm
                tenantSlug={tenantSlug}
                items={menu.items}
                categories={menu.categories}
              />
            </div>
          </details>

          <RulesList tenantSlug={tenantSlug} rules={rules} menu={menu} />
        </section>

        <section className="space-y-4">
          <header className="flex items-center gap-2">
            <Gift className="size-4 text-primary" />
            <h2 className="font-display text-base font-semibold tracking-tight">Recompensas</h2>
          </header>
          <NewRewardForm tenantSlug={tenantSlug} />
          <RewardsList tenantSlug={tenantSlug} rewards={rewards} />
        </section>
      </div>
    </div>
  )
}
