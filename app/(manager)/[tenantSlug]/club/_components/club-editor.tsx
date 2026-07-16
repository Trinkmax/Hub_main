'use client'

import {
  Eye,
  Gift,
  Handshake,
  Info,
  type LucideIcon,
  Sparkles,
  Stamp,
  Star,
  Wallet,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { SlidingTabs } from '@/components/ui/sliding-tabs'
import type { getCapturePromptConfig } from '@/lib/capture-prompt/queries'
import type { listItemTags } from '@/lib/item-tags/queries'
import type { listMenu } from '@/lib/menu/queries'
import type { TierBenefit } from '@/lib/points/benefits'
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
import { PartnersManager as PartnersManagerReal } from '../aliados/_components/partners-manager'
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
const CLUB_TAB_VALUES = new Set<ClubTab>(['programa', 'aliados', 'bienvenida', 'punch'])

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
  redemptionConfig: Awaited<ReturnType<typeof getPointsRedemptionConfig>>
  welcomeConfig: Awaited<ReturnType<typeof getWelcomeRewardConfig>>
  capturePrompt: Awaited<ReturnType<typeof getCapturePromptConfig>>
  punchTemplates: Awaited<ReturnType<typeof listPunchCardTemplates>>
  /** Estado inicial del tab por deep-link (?tab=). Default: programa. */
  initialTab?: ClubTab
}

function InfoBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="card-hairline flex items-start gap-3 rounded-xl border border-border/70 bg-primary/5 p-4 text-sm">
      <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <div className="text-xs text-muted-foreground text-pretty">{children}</div>
    </div>
  )
}

const CLUB_TABS: { value: ClubTab; label: React.ReactNode }[] = [
  {
    value: 'programa',
    label: (
      <span className="inline-flex items-center gap-1.5">
        <Sparkles className="size-3.5" />
        Puntos y niveles
      </span>
    ),
  },
  {
    value: 'aliados',
    label: (
      <span className="inline-flex items-center gap-1.5">
        <Handshake className="size-3.5" />
        Aliados
      </span>
    ),
  },
  {
    value: 'bienvenida',
    label: (
      <span className="inline-flex items-center gap-1.5">
        <Star className="size-3.5" />
        Bienvenida
      </span>
    ),
  },
  {
    value: 'punch',
    label: (
      <span className="inline-flex items-center gap-1.5">
        <Stamp className="size-3.5" />
        Punch cards
      </span>
    ),
  },
]

/** Encabezado de una de las tres etapas del programa (ganar → niveles → canjear). */
function ProgramaSection({
  step,
  icon: Icon,
  title,
  hint,
  children,
}: {
  step: number
  icon: LucideIcon
  title: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-4">
      <header className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="space-y-0.5">
          <h2 className="font-display text-lg font-semibold tracking-tight">
            <span className="tabular-nums text-muted-foreground/50">{step}.</span> {title}
          </h2>
          <p className="max-w-prose text-xs text-muted-foreground">{hint}</p>
        </div>
      </header>
      <div className="space-y-4">{children}</div>
    </section>
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
    redemptionConfig,
    welcomeConfig,
    capturePrompt,
    punchTemplates,
    initialTab,
  } = props

  // La URL (?tab=) es la ÚNICA fuente de verdad del tab activo. No hay estado
  // local: así el resaltado del sidebar (que lee la URL) y el contenido nunca se
  // desincronizan, y los deep-links del sidebar funcionan sin remontar la página.
  const pathname = usePathname()
  const rawTab = useSearchParams().get('tab')
  const clubTab: ClubTab =
    rawTab && CLUB_TAB_VALUES.has(rawTab as ClubTab)
      ? (rawTab as ClubTab)
      : (initialTab ?? 'programa')

  // Cambiar de tab escribe la URL con la History API nativa (Next la sincroniza con
  // useSearchParams): es instantáneo, sin round-trip al server ni re-fetch de los
  // datos del club. SIEMPRE con ?tab= explícito: si 'programa' fuera sin query,
  // rawTab quedaría null y el fallback a initialTab (prop congelada del server,
  // p. ej. 'aliados' tras un deep-link) dejaría ese tab inalcanzable.
  const handleTabChange = (next: ClubTab) => {
    window.history.replaceState(null, '', `${pathname}?tab=${next}`)
  }

  const perItemRules = (rules as Rule[]).filter((r) => r.type === 'per_item')

  return (
    <div className="space-y-6">
      {/* CABECERA */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Fidelización
          </p>
          <h1 className="mt-0.5 font-serif text-3xl font-semibold tracking-tight">
            Club de beneficios
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Niveles, puntos, recompensas, aliados y punch cards — todo el sistema de fidelización de
            tu bar.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ClubTourButton />
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href={`/carta/${tenantSlug}`} target="_blank" rel="noopener">
              <Eye className="size-4" />
              Ver carta
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href={`/${tenantSlug}/club/simular`} data-tour="club-simular">
              <Wallet className="size-4" />
              Simular wallet
            </Link>
          </Button>
        </div>
      </div>

      <div data-tour="club-tabs" className="w-fit max-w-full">
        <SlidingTabs
          size="sm"
          className="max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          value={clubTab}
          onChange={handleTabChange}
          tabs={CLUB_TABS}
        />
      </div>

      <div
        key={clubTab}
        className="animate-in fade-in slide-in-from-bottom-1 duration-[var(--duration-base)]"
      >
        {clubTab === 'programa' ? (
          <div className="space-y-10">
            {/* ① CÓMO GANAN — reglas de puntos (compacto, full-width). */}
            <ProgramaSection
              step={1}
              icon={Star}
              title="Cómo ganan puntos"
              hint="Cuánto suma cada consumo. Es la base de todo el club."
            >
              <NewPerAmountForm tenantSlug={tenantSlug} />
              <details className="card-hairline group rounded-xl border bg-card/60 p-4">
                <summary className="cursor-pointer list-none text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">Reglas avanzadas</p>
                      <p className="text-xs text-muted-foreground">
                        Bonificar puntos extra por ítem o categoría
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
            </ProgramaSection>

            {/* ② NIVELES — la escalera + sus beneficios. */}
            <ProgramaSection
              step={2}
              icon={Sparkles}
              title="Niveles"
              hint="Se alcanzan por puntos de categoría (lo ganado en los últimos 4 meses): suben con la actividad y bajan si el cliente deja de venir. Cada nivel desbloquea beneficios desde Beneficios en su fila."
            >
              <TiersList
                tenantSlug={tenantSlug}
                tiers={tiers}
                benefitsByTier={benefitsByTier}
                rewards={activeRewards}
                partners={partners}
              />
            </ProgramaSection>

            {/* ③ CÓMO CANJEAN — pagar con puntos + catálogo visual con fotos. */}
            <ProgramaSection
              step={3}
              icon={Gift}
              title="Cómo canjean sus puntos"
              hint="Lo que ve el cliente en la carta. Cargá una foto en cada recompensa para que se vea rica."
            >
              <RedemptionConfigForm tenantSlug={tenantSlug} initial={redemptionConfig} />
              <NewRewardForm tenantSlug={tenantSlug} tenantId={tenantId} tiers={tiers} />
              <RewardsList
                tenantSlug={tenantSlug}
                tenantId={tenantId}
                rewards={rewards}
                tiers={tiers}
              />
            </ProgramaSection>
          </div>
        ) : clubTab === 'aliados' ? (
          <div className="space-y-5">
            <InfoBanner>
              Las marcas inactivas no se muestran a los clientes. Activá cada una cuando cierres el
              acuerdo y cargues su logo.
            </InfoBanner>
            <PartnersManagerReal tenantSlug={tenantSlug} tenantId={tenantId} partners={partners} />
          </div>
        ) : clubTab === 'bienvenida' ? (
          <div className="space-y-6">
            {activeRewards.length === 0 ? (
              <EmptyState
                icon={Gift}
                title="Todavía no tenés recompensas"
                description="Creá una recompensa en Puntos y niveles para usarla como regalo de bienvenida."
              />
            ) : (
              <WelcomeRewardForm
                tenantSlug={tenantSlug}
                initialConfig={welcomeConfig}
                availableRewards={activeRewards}
              />
            )}
            <section className="space-y-3">
              <h2 className="font-serif text-xl font-semibold tracking-tight">Captura de datos</h2>
              <CapturePromptForm tenantSlug={tenantSlug} config={capturePrompt} />
            </section>
          </div>
        ) : (
          <PunchCardsManager
            tenantSlug={tenantSlug}
            tenantId={tenantId}
            initialTemplates={punchTemplates}
            items={menu.items.map((i) => ({ id: i.id, name: i.name }))}
            categories={menu.categories.map((c) => ({ id: c.id, name: c.name }))}
            tags={tags}
            rewards={rewards.map((r) => ({ id: r.id, name: r.name }))}
          />
        )}
      </div>
    </div>
  )
}
