import { Gift, Star } from 'lucide-react'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { listMenu } from '@/lib/menu/queries'
import { listRewards, listRules } from '@/lib/points/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { NewPerAmountForm } from './_components/new-per-amount-form'
import { NewPerItemForm } from './_components/new-per-item-form'
import { NewRewardForm } from './_components/new-reward-form'
import { RewardsList } from './_components/rewards-list'
import { RulesList } from './_components/rules-list'

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

  const [rules, rewards, menu] = await Promise.all([
    listRules({ tenantId: access.tenant.id }),
    listRewards({ tenantId: access.tenant.id }),
    listMenu({ tenantId: access.tenant.id }),
  ])

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Catálogo"
        title="Puntos y recompensas"
        description="Definí cómo se ganan los puntos y qué pueden canjear los clientes."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-4">
          <header className="flex items-center gap-2">
            <Star className="size-4 text-primary" />
            <h2 className="font-display text-base font-semibold tracking-tight">
              Reglas de puntos
            </h2>
          </header>

          <NewPerAmountForm tenantSlug={tenantSlug} />
          <NewPerItemForm tenantSlug={tenantSlug} items={menu.items} categories={menu.categories} />
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
