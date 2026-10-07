import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getBonusRule, listManagers, listRateTiers } from '@/lib/salon/queries'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { settingsHref } from '../_components/settings-nav'
import { BonusRuleCard } from './_components/bonus-rule-card'
import { ManagersList, type TeamMemberOption } from './_components/managers-list'
import { RateTiersEditor } from './_components/rate-tiers-editor'

type RpcMember = {
  id: string
  user_id: string
  email: string
  full_name: string | null
}

export const metadata = { title: 'Comisiones · Configuración' }
export const dynamic = 'force-dynamic'

const TABS = ['tarifas', 'bonus', 'gestores'] as const
type TabValue = (typeof TABS)[number]

export default async function ComisionesConfigPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams

  // El form de reserva linkea acá con ?tab=gestores cuando falta cargar un
  // gestor. Sin esto la página abría siempre en "Tarifas" y el dueño no
  // encontraba el ABM — que es justo el problema que ese link viene a resolver.
  const requestedTab = typeof sp.tab === 'string' ? sp.tab : undefined
  const activeTab: TabValue = TABS.includes(requestedTab as TabValue)
    ? (requestedTab as TabValue)
    : 'tarifas'

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (e) {
    if (e instanceof TenantNotFoundError) notFound()
    if (e instanceof RoleRequiredError) notFound()
    throw e
  }

  const supabase = await createClient()
  const [tiers, bonus, managers, membersRes] = await Promise.all([
    listRateTiers({ tenantId: access.tenant.id }),
    getBonusRule({ tenantId: access.tenant.id }),
    listManagers({ tenantId: access.tenant.id, onlyActive: false }),
    // Misma vía que la página de Equipo: RPC owner-only con email/full_name.
    supabase.rpc('get_tenant_members', { p_tenant: access.tenant.id }),
  ])
  if (membersRes.error) {
    console.error('[config.comisiones] get_tenant_members', membersRes.error)
  }
  const members: TeamMemberOption[] = ((membersRes.data ?? []) as RpcMember[]).map((r) => ({
    user_id: r.user_id,
    email: r.email,
    full_name: r.full_name,
  }))

  // Las pestañas escriben ?tab= al cambiar (`syncParam`): el link de una
  // pestaña se puede copiar y «atrás» vuelve a donde estaba.
  return (
    <Tabs syncParam="tab" defaultValue={activeTab} className="gap-8">
      <PageHeader
        back={{ href: settingsHref(tenantSlug), label: 'Configuración' }}
        title="Comisiones"
        description="Cuánto cobra cada gestor por persona reservada, el extra cuando un evento se llena y quiénes cobran."
        tabs={
          <TabsList aria-label="Partes de las comisiones">
            <TabsTrigger value="tarifas">Tarifas</TabsTrigger>
            <TabsTrigger value="bonus">Evento lleno</TabsTrigger>
            <TabsTrigger value="gestores">Gestores</TabsTrigger>
          </TabsList>
        }
      />
      <TabsContent value="tarifas">
        <RateTiersEditor tenantSlug={tenantSlug} initial={tiers} />
      </TabsContent>
      <TabsContent value="bonus">
        <BonusRuleCard tenantSlug={tenantSlug} initial={bonus} />
      </TabsContent>
      <TabsContent value="gestores">
        <ManagersList
          tenantSlug={tenantSlug}
          initial={managers}
          members={members}
          membersUnavailable={Boolean(membersRes.error)}
        />
      </TabsContent>
    </Tabs>
  )
}
