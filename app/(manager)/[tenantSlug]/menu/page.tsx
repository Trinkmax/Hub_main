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
import { MenuHub } from './_components/menu-hub'

export const metadata = { title: 'Carta y club' }

export default async function MenuPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
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
  const tenantId = access.tenant.id

  // Editor unificado: se trae todo (carta + sistema de puntos) para editarlo desde
  // una sola pantalla con el toggle deslizante Carta ↔ Club.
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
    <MenuHub
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
    />
  )
}
