import { notFound } from 'next/navigation'
import { getCapturePromptConfig } from '@/lib/capture-prompt/queries'
import { listItemTags } from '@/lib/item-tags/queries'
import { listMenu } from '@/lib/menu/queries'
import type { TierBenefit } from '@/lib/points/benefits'
import {
  getPointsRedemptionConfig,
  listActiveRewards,
  listPartners,
  listRewards,
  listRules,
  listTierBenefits,
  listTiers,
} from '@/lib/points/queries'
import { listPunchCardTemplates } from '@/lib/punch-cards/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { getWelcomeRewardConfig } from '@/lib/welcome-reward/queries'
import { ClubEditor, type ClubTab } from './_components/club-editor'

export const metadata = { title: 'Club de beneficios' }

// Tabs válidos (deep-link desde el sidebar y las viejas rutas /club/* que redirigen acá).
const CLUB_TABS = new Set<ClubTab>(['programa', 'aliados', 'bienvenida', 'punch'])

export default async function ClubPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const initialTab =
    typeof sp.tab === 'string' && CLUB_TABS.has(sp.tab as ClubTab)
      ? (sp.tab as ClubTab)
      : ('programa' as const)

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }
  const tenantId = access.tenant.id

  // El punch-cards y las reglas por-ítem necesitan la carta (ítems + categorías);
  // por eso el editor del Club también trae el menú, aunque la Carta se edite aparte.
  const [
    menu,
    tags,
    tiers,
    benefits,
    activeRewards,
    rewards,
    rules,
    partners,
    redemptionConfig,
    welcomeConfig,
    capturePrompt,
    punchTemplates,
  ] = await Promise.all([
    listMenu({ tenantId }),
    listItemTags(tenantId),
    listTiers({ tenantId }),
    listTierBenefits({ tenantId }),
    listActiveRewards({ tenantId }),
    listRewards({ tenantId }),
    listRules({ tenantId }),
    listPartners({ tenantId }),
    getPointsRedemptionConfig(tenantId),
    getWelcomeRewardConfig(tenantId),
    getCapturePromptConfig(tenantId),
    listPunchCardTemplates(tenantId),
  ])

  const benefitsByTier: Record<string, TierBenefit[]> = {}
  for (const b of benefits) {
    const bucket = benefitsByTier[b.tier_id] ?? []
    bucket.push(b)
    benefitsByTier[b.tier_id] = bucket
  }

  return (
    <ClubEditor
      tenantSlug={tenantSlug}
      tenantId={tenantId}
      menu={menu}
      tags={tags}
      tiers={tiers}
      benefitsByTier={benefitsByTier}
      activeRewards={activeRewards}
      rewards={rewards}
      rules={rules}
      partners={partners}
      redemptionConfig={redemptionConfig}
      welcomeConfig={welcomeConfig}
      capturePrompt={capturePrompt}
      punchTemplates={punchTemplates}
      initialTab={initialTab}
    />
  )
}
