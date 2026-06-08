import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getBonusRule, listManagers, listRateTiers } from '@/lib/salon/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { BonusRuleCard } from './_components/bonus-rule-card'
import { ManagersList } from './_components/managers-list'
import { RateTiersEditor } from './_components/rate-tiers-editor'

export const metadata = { title: 'Comisiones · Configuración' }
export const dynamic = 'force-dynamic'

export default async function ComisionesConfigPage({
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

  const [tiers, bonus, managers] = await Promise.all([
    listRateTiers({ tenantId: access.tenant.id }),
    getBonusRule({ tenantId: access.tenant.id }),
    listManagers({ tenantId: access.tenant.id, onlyActive: false }),
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
        title="Comisiones"
        description="Tarifas por tipo de servicio + bonus por evento lleno + qué gestores cobran."
      />
      <Tabs defaultValue="tarifas">
        <TabsList>
          <TabsTrigger value="tarifas">Tarifas</TabsTrigger>
          <TabsTrigger value="bonus">Bonus full</TabsTrigger>
          <TabsTrigger value="gestores">Gestores</TabsTrigger>
        </TabsList>
        <TabsContent value="tarifas" className="mt-4">
          <RateTiersEditor tenantSlug={tenantSlug} initial={tiers} />
        </TabsContent>
        <TabsContent value="bonus" className="mt-4">
          <BonusRuleCard tenantSlug={tenantSlug} initial={bonus} />
        </TabsContent>
        <TabsContent value="gestores" className="mt-4">
          <ManagersList tenantSlug={tenantSlug} initial={managers} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
