'use client'

import { ChevronLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { WalletData } from '@/lib/wallet/queries'
import { Carnet } from './carnet'
import { HistoryAccordion } from './history-accordion'
import { HowItWorks } from './how-it-works'
import { PartnerTiers } from './partner-tiers'
import { PendingBenefits } from './pending-benefits'
import { PersonalQr } from './personal-qr'
import { PunchCards } from './punch-cards'
import type { WalletTicket } from './redemption-ticket'
import { ReviewCta } from './review-cta'
import { RewardDetail } from './reward-detail'
import { RewardsGrid } from './rewards-grid'
import { TierLadder } from './tier-ladder'
import { TierProgression } from './tier-progression'
import { UpcomingEvents } from './upcoming-events'
import { VisitsTimeline } from './visits-timeline'
import { formatPoints } from './wallet-format'
import { WalletHeader } from './wallet-header'
import { WalletLive } from './wallet-live'
import { WalletPartners } from './wallet-partners'

// Orquestador de la wallet como VISTAS in-place (main → niveles / canjeables /
// detalle de un beneficio / cómo funciona), no scroll infinito ni navegación por
// rutas. Funciona igual standalone (/c/[token]) y embebida en el sheet de la
// carta (que no puede navegar). Al cambiar de vista resetea el scroll del
// contenedor (window o cuerpo del sheet).
//
// El canje generado se guarda también acá (`issued`): la action devuelve el
// ticket con su QR y lo mostramos en el acto, sin esperar a que el refresh del
// server traiga de vuelta el mismo dato. `router.refresh()` corre igual detrás
// para que el resto de la wallet (puntos, tarjetas, pendientes) quede al día.

type View = 'main' | 'niveles' | 'canjeables' | 'comofunciona' | 'beneficio'
type Reward = WalletData['rewards'][number]

function resetScroll(el: HTMLElement | null): void {
  let p = el?.parentElement ?? null
  while (p) {
    const oy = getComputedStyle(p).overflowY
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) {
      p.scrollTo({ top: 0 })
      return
    }
    p = p.parentElement
  }
  if (typeof window !== 'undefined') window.scrollTo({ top: 0 })
}

function BackHeader({
  title,
  subtitle,
  onBack,
}: {
  title: string
  subtitle?: string
  onBack: () => void
}) {
  return (
    <header className="flex items-center gap-3">
      <button
        type="button"
        onClick={onBack}
        aria-label="Volver a mi wallet"
        className="press-lift grid size-10 shrink-0 place-items-center rounded-full border border-border/70 bg-card text-foreground shadow-sm outline-none transition-colors hover:border-(--brand-accent)/40 focus-visible:ring-2 focus-visible:ring-foreground"
      >
        <ChevronLeft className="size-5" aria-hidden="true" />
      </button>
      <div className="min-w-0">
        <h1 className="truncate font-display text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="truncate text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
    </header>
  )
}

export function WalletViews({
  data,
  qrDataUrl,
  embedded = false,
}: {
  data: WalletData
  qrDataUrl: string
  embedded?: boolean
}): React.JSX.Element {
  const [view, setView] = useState<View>('main')
  const [selected, setSelected] = useState<Reward | null>(null)
  const [issued, setIssued] = useState<WalletTicket | null>(null)
  const [cancelledId, setCancelledId] = useState<string | null>(null)
  const [rewardOrigin, setRewardOrigin] = useState<View>('main')
  const rootRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  // Al cambiar de vista: en `main` volvés arriba del todo (muestra el saludo del
  // sheet). En una sub-vista, llevás su tope al tope del scroll (el header del
  // sheet queda arriba fuera de vista) → se siente una pantalla propia.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    if (view === 'main') resetScroll(root)
    else root.scrollIntoView({ block: 'start', behavior: 'auto' })
  }, [view])

  const {
    customer,
    tenant,
    tier,
    categoryWindowMonths,
    expiry,
    earn,
    progression,
    partners,
    rewards,
    punchCards,
    visits,
    events,
    ledger,
    redemptions,
    pendingBenefits,
    partnerTiers,
  } = data
  const hasTiers = progression.length > 0
  const hasRewards = rewards.length > 0
  const tierName = tier.current?.name

  // El canje recién generado gana sobre el que trajo el server: si acabás de
  // pedirlo, el refresh todavía puede no haber llegado. Y al cancelar tapamos el
  // que sigue viniendo en el payload viejo, o el ticket reaparecería un segundo.
  const fromServer = data.activeRedemption ?? null
  const activeTicket: WalletTicket | null =
    issued ?? (fromServer && fromServer.redemptionId !== cancelledId ? fromServer : null)

  const onSelectReward = (reward: Reward) => {
    // "Volver" tiene que devolverte de donde viniste: al catálogo si estabas ahí,
    // al inicio si tocaste una card del carrusel de la portada.
    setRewardOrigin(view === 'canjeables' ? 'canjeables' : 'main')
    setSelected(reward)
    setView('beneficio')
  }

  const onIssued = (ticket: WalletTicket) => {
    setCancelledId(null)
    setIssued(ticket)
    setSelected(null)
    setView('main')
    router.refresh()
  }

  const onCleared = (redemptionId: string) => {
    setIssued(null)
    setCancelledId(redemptionId)
    router.refresh()
  }

  return (
    <main className={embedded ? 'bg-transparent' : 'bg-app-gradient min-h-[100dvh]'}>
      {/* Mantiene la pantalla al día sola: el canje que el mozo acaba de validar
          y los puntos que el cajero acaba de acreditar aparecen sin recargar. */}
      <WalletLive qrToken={customer.qrToken} rev={data.rev} urgent={activeTicket !== null} />
      <div
        ref={rootRef}
        className={cn(
          'mx-auto flex max-w-md flex-col gap-8 px-4 pb-16',
          embedded ? 'pt-2' : 'pt-8 sm:pt-12',
        )}
      >
        {view === 'niveles' ? (
          <div
            key="niveles"
            className="animate-in fade-in slide-in-from-right-3 flex flex-col gap-6 duration-[var(--duration-slow)]"
          >
            <BackHeader
              title="Niveles y beneficios"
              subtitle={tierName ? `Estás en ${tierName}` : undefined}
              onBack={() => setView('main')}
            />
            <TierLadder
              progression={progression}
              tier={tier}
              categoryPoints={customer.categoryPoints}
              windowMonths={categoryWindowMonths}
            />
            <TierProgression progression={progression} variant="full" />
            <PartnerTiers progression={progression} partnerTiers={partnerTiers} />
            <WalletPartners partners={partners} tierName={tierName} />
          </div>
        ) : view === 'canjeables' ? (
          <div
            key="canjeables"
            className="animate-in fade-in slide-in-from-right-3 flex flex-col gap-6 duration-[var(--duration-slow)]"
          >
            <BackHeader
              title="Catálogo de canje"
              subtitle="Elegí uno y te damos el código"
              onBack={() => setView('main')}
            />
            <RewardsGrid
              rewards={rewards}
              pointsBalance={customer.pointsBalance}
              onSelect={onSelectReward}
            />
          </div>
        ) : view === 'beneficio' && selected ? (
          <div
            key={`beneficio-${selected.id}`}
            className="animate-in fade-in slide-in-from-right-3 flex flex-col gap-6 duration-[var(--duration-slow)]"
          >
            <BackHeader
              title={selected.name}
              subtitle={`${formatPoints(selected.costPoints)} pts · tenés ${formatPoints(customer.pointsBalance)}`}
              onBack={() => setView(rewardOrigin)}
            />
            <RewardDetail
              reward={selected}
              pointsBalance={customer.pointsBalance}
              qrToken={customer.qrToken}
              hasActiveRedemption={activeTicket !== null}
              onIssued={onIssued}
            />
          </div>
        ) : view === 'comofunciona' ? (
          <div
            key="comofunciona"
            className="animate-in fade-in slide-in-from-right-3 flex flex-col gap-6 duration-[var(--duration-slow)]"
          >
            <BackHeader
              title="Cómo funciona"
              subtitle="Tus puntos, tu nivel y cómo sumás"
              onBack={() => setView('main')}
            />
            <HowItWorks
              windowMonths={categoryWindowMonths}
              earn={earn}
              tierColor={tier.current?.color ?? null}
              onNiveles={hasTiers ? () => setView('niveles') : undefined}
              onCanjeables={hasRewards ? () => setView('canjeables') : undefined}
            />
          </div>
        ) : (
          <>
            {!embedded ? <WalletHeader firstName={customer.firstName} /> : null}
            <Carnet
              customer={customer}
              tenant={tenant}
              tier={tier}
              categoryPoints={customer.categoryPoints}
              pointsBalance={customer.pointsBalance}
              windowMonths={categoryWindowMonths}
              expiry={expiry}
              onNiveles={hasTiers ? () => setView('niveles') : undefined}
              onCanjeables={hasRewards ? () => setView('canjeables') : undefined}
              onHelp={() => setView('comofunciona')}
            />
            <PendingBenefits
              benefits={pendingBenefits}
              active={activeTicket}
              qrToken={customer.qrToken}
              onIssued={onIssued}
              onCleared={onCleared}
            />
            <TierLadder
              progression={progression}
              tier={tier}
              categoryPoints={customer.categoryPoints}
              windowMonths={categoryWindowMonths}
            />
            <TierProgression
              progression={progression}
              variant="current"
              onMore={hasTiers ? () => setView('niveles') : undefined}
            />
            <RewardsGrid
              rewards={rewards}
              pointsBalance={customer.pointsBalance}
              onSelect={onSelectReward}
              previewCount={6}
              onMore={hasRewards ? () => setView('canjeables') : undefined}
            />
            <WalletPartners partners={partners} tierName={tierName} />
            <PunchCards
              cards={punchCards}
              tenantName={tenant.name}
              qrToken={customer.qrToken}
              blocked={activeTicket !== null}
              onIssued={onIssued}
            />
            <PersonalQr qrDataUrl={qrDataUrl} qrToken={customer.qrToken} />
            <VisitsTimeline visits={visits} />
            <UpcomingEvents events={events} />
            <ReviewCta qrToken={customer.qrToken} />
            <HistoryAccordion redemptions={redemptions} ledger={ledger} />
            <footer className="pt-2 text-center text-[11px] text-muted-foreground">
              <p>Esta pantalla es personal y se actualiza sola.</p>
            </footer>
          </>
        )}
      </div>
    </main>
  )
}
