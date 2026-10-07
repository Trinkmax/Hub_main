'use client'

import { Eye, Gift, Handshake, Sparkles, Stamp, Star, Wallet } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { Disclosure } from '@/components/ui/disclosure'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { ReloadLink } from '@/components/ui/reload-link'
import { Section } from '@/components/ui/section'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { getCapturePromptConfig } from '@/lib/capture-prompt/queries'
import type { listItemTags } from '@/lib/item-tags/queries'
import type { listMenu } from '@/lib/menu/queries'
import type { PartnerBenefit, TierBenefit } from '@/lib/points/benefits'
import type {
  getPointsRedemptionConfig,
  listActiveRewards,
  listPartners,
  listRewards,
  listRules,
  listTiers,
} from '@/lib/points/queries'
import type { listPunchCardTemplates } from '@/lib/punch-cards/queries'
import type { getWelcomeRewardConfig } from '@/lib/welcome-reward/queries'
import { PartnersManager } from '../aliados/_components/partners-manager'
import { CapturePromptForm } from '../bienvenida/_components/capture-prompt-form'
import { WelcomeRewardForm } from '../bienvenida/_components/welcome-reward-form'
import { PunchCardsManager } from '../punch-cards/_components/punch-cards-manager'
import { NewPerAmountForm } from '../puntos/_components/new-per-amount-form'
import { NewPerItemForm } from '../puntos/_components/new-per-item-form'
import { NewRewardForm } from '../puntos/_components/new-reward-form'
import { RedemptionConfigForm } from '../puntos/_components/redemption-config-form'
import { RewardsList } from '../puntos/_components/rewards-list'
import { RulesList } from '../puntos/_components/rules-list'
import { ClubTourButton } from './club-tour'
import { TiersList } from './tiers-list'

// 'programa' fusiona lo que antes eran dos tabs (Niveles + Puntos y recompensas)
// en un solo flujo vertical: ganar → niveles → canjear.
export type ClubTab = 'programa' | 'aliados' | 'bienvenida' | 'punch'
const CLUB_TAB_VALUES = new Set<string>(['programa', 'aliados', 'bienvenida', 'punch'])

function isClubTab(value: string): value is ClubTab {
  return CLUB_TAB_VALUES.has(value)
}

type Rule = {
  id: string
  type: 'per_amount' | 'per_item'
  config: Record<string, unknown>
  priority: number
  active: boolean
}

export type ClubEditorProps = {
  tenantSlug: string
  tenantId: string
  menu: Awaited<ReturnType<typeof listMenu>>
  tags: Awaited<ReturnType<typeof listItemTags>>
  tiers: Awaited<ReturnType<typeof listTiers>>
  benefitsByTier: Record<string, TierBenefit[]>
  activeRewards: Awaited<ReturnType<typeof listActiveRewards>>
  rewards: Awaited<ReturnType<typeof listRewards>>
  rules: Awaited<ReturnType<typeof listRules>>
  partners: Awaited<ReturnType<typeof listPartners>>
  /** Beneficios de cada marca aliada con los niveles a los que llega cada uno. */
  partnerBenefits: PartnerBenefit[]
  redemptionConfig: Awaited<ReturnType<typeof getPointsRedemptionConfig>>
  welcomeConfig: Awaited<ReturnType<typeof getWelcomeRewardConfig>>
  capturePrompt: Awaited<ReturnType<typeof getCapturePromptConfig>>
  punchTemplates: Awaited<ReturnType<typeof listPunchCardTemplates>>
  /** Estado inicial del tab por deep-link (?tab=). Default: programa. */
  initialTab?: ClubTab
}

/** El número de la etapa del programa (ganar → niveles → canjear) delante del título. */
function StepTitle({ step, children }: { step: number; children: React.ReactNode }) {
  return (
    <>
      <span className="type-amount text-subtle-foreground">{step}.</span> {children}
    </>
  )
}

export function ClubEditor(props: ClubEditorProps): React.JSX.Element {
  const {
    tenantSlug,
    tenantId,
    menu,
    tags,
    tiers,
    benefitsByTier,
    activeRewards,
    rewards,
    rules,
    partners,
    partnerBenefits,
    redemptionConfig,
    welcomeConfig,
    capturePrompt,
    punchTemplates,
    initialTab,
  } = props

  // La pestaña vive en la URL (?tab=): `Tabs syncParam` la escribe con
  // history.replaceState (sin pedirle nada al server) y sigue a los links del
  // menú lateral que apuntan a ?tab=…. El estado propio está para poder
  // mandar a otra pestaña desde un estado vacío («Ir a Puntos y niveles»).
  const defaultTab = initialTab ?? 'programa'
  const [tab, setTab] = useState<ClubTab>(defaultTab)
  const goToProgram = () => setTab('programa')

  const perItemRules = (rules as Rule[]).filter((r) => r.type === 'per_item')
  const activePerItem = perItemRules.filter((r) => r.active).length

  return (
    <PageShell width="comfortable">
      <Tabs
        syncParam="tab"
        value={tab}
        defaultValue={defaultTab}
        onValueChange={(next) => {
          if (isClubTab(next)) setTab(next)
        }}
        className="gap-8"
      >
        <PageHeader
          title="Club de beneficios"
          description="Niveles, puntos, recompensas, aliados y punch cards: todo el sistema de fidelización de tu bar."
          actions={
            <>
              <ClubTourButton />
              <Button asChild variant="secondary">
                <ReloadLink href={`/carta/${tenantSlug}`} newTab>
                  <Eye aria-hidden="true" />
                  Ver carta
                </ReloadLink>
              </Button>
              <Button asChild variant="secondary">
                <Link href={`/${tenantSlug}/club/simular`} data-tour="club-simular">
                  <Wallet aria-hidden="true" />
                  Simular wallet
                </Link>
              </Button>
            </>
          }
          tabs={
            <TabsList data-tour="club-tabs" aria-label="Áreas del club">
              <TabsTrigger value="programa" icon={Sparkles}>
                Puntos y niveles
              </TabsTrigger>
              <TabsTrigger value="aliados" icon={Handshake}>
                Aliados
              </TabsTrigger>
              <TabsTrigger value="bienvenida" icon={Star}>
                Bienvenida
              </TabsTrigger>
              <TabsTrigger value="punch" icon={Stamp}>
                Punch cards
              </TabsTrigger>
            </TabsList>
          }
        />

        <TabsContent value="programa" className="flex flex-col gap-10">
          {/* ① CÓMO GANAN — reglas de puntos. */}
          <Section
            title={<StepTitle step={1}>Cómo ganan puntos</StepTitle>}
            description="Cuánto suma cada consumo. Es la base de todo el club."
          >
            <NewPerAmountForm tenantSlug={tenantSlug} />
            <Disclosure
              title="Reglas avanzadas"
              description={
                <>
                  Puntos extra por un ítem o una categoría
                  {activePerItem > 0
                    ? ` · ${activePerItem} ${activePerItem === 1 ? 'activa' : 'activas'}`
                    : ''}
                  .
                </>
              }
            >
              <NewPerItemForm
                tenantSlug={tenantSlug}
                items={menu.items}
                categories={menu.categories}
              />
            </Disclosure>
            <RulesList tenantSlug={tenantSlug} rules={rules} menu={menu} />
          </Section>

          {/* ② NIVELES — la escalera y sus beneficios. */}
          <Section
            divider
            title={<StepTitle step={2}>Niveles</StepTitle>}
            description="Se alcanzan con los puntos de categoría (lo ganado en los últimos 4 meses): suben con la actividad y bajan si el cliente deja de venir. Lo que desbloquea cada nivel se carga desde «Beneficios», en su fila."
          >
            <TiersList
              tenantSlug={tenantSlug}
              tenantId={tenantId}
              tiers={tiers}
              benefitsByTier={benefitsByTier}
              rewards={activeRewards}
              partners={partners}
            />
          </Section>

          {/* ③ CÓMO CANJEAN — pagar con puntos y el catálogo con fotos. */}
          <Section
            divider
            title={<StepTitle step={3}>Cómo canjean sus puntos</StepTitle>}
            description="Lo que ve el cliente en la carta. Cargá una foto en cada recompensa para que se vea rica."
          >
            <RedemptionConfigForm tenantSlug={tenantSlug} initial={redemptionConfig} />
            <NewRewardForm tenantSlug={tenantSlug} tenantId={tenantId} tiers={tiers} />
            <RewardsList
              tenantSlug={tenantSlug}
              tenantId={tenantId}
              rewards={rewards}
              tiers={tiers}
            />
          </Section>
        </TabsContent>

        <TabsContent value="aliados" className="flex flex-col gap-6">
          <Callout tone="info">
            Cada marca tiene su propia lista de beneficios y cada beneficio elige a qué niveles
            llega: Guapa estética puede dar 10% a Select y Gold, y 30% a Black. El socio ve solo el
            beneficio de SU nivel, no la suma de los de abajo.
          </Callout>
          <PartnersManager
            tenantSlug={tenantSlug}
            tenantId={tenantId}
            partners={partners}
            tiers={tiers}
            partnerBenefits={partnerBenefits}
          />
        </TabsContent>

        <TabsContent value="bienvenida" className="flex flex-col gap-10">
          <Section
            title="Regalo de bienvenida"
            description="Lo que recibe cada cliente la primera vez que se suma al club escaneando el QR."
          >
            {activeRewards.length === 0 ? (
              <EmptyState
                icon={Gift}
                title="Todavía no tenés recompensas"
                description="El regalo de bienvenida es una de tus recompensas. Creá la primera en Puntos y niveles y volvé acá a elegirla."
                action={<Button onClick={goToProgram}>Ir a Puntos y niveles</Button>}
              />
            ) : (
              <WelcomeRewardForm
                tenantSlug={tenantSlug}
                initialConfig={welcomeConfig}
                availableRewards={activeRewards}
              />
            )}
          </Section>
          <Section
            divider
            title="Captura de datos"
            description="La invitación a registrarse que ve el comensal al escanear el QR de la mesa."
          >
            <CapturePromptForm tenantSlug={tenantSlug} config={capturePrompt} />
          </Section>
        </TabsContent>

        <TabsContent value="punch">
          <PunchCardsManager
            tenantSlug={tenantSlug}
            tenantId={tenantId}
            initialTemplates={punchTemplates}
            items={menu.items.map((i) => ({ id: i.id, name: i.name }))}
            categories={menu.categories.map((c) => ({ id: c.id, name: c.name }))}
            tags={tags}
            rewards={rewards.map((r) => ({ id: r.id, name: r.name }))}
            tiers={tiers}
            onGoToRewards={goToProgram}
          />
        </TabsContent>
      </Tabs>
    </PageShell>
  )
}
