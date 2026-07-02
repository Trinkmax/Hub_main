'use client'

import { ChevronLeft } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { WalletData } from '@/lib/wallet/queries'
import { Carnet } from './carnet'
import { HistoryAccordion } from './history-accordion'
import { PendingBenefits } from './pending-benefits'
import { PersonalQr } from './personal-qr'
import { PunchCards } from './punch-cards'
import { ReviewCta } from './review-cta'
import { RewardsGrid } from './rewards-grid'
import { TierLadder } from './tier-ladder'
import { TierProgression } from './tier-progression'
import { UpcomingEvents } from './upcoming-events'
import { VisitsTimeline } from './visits-timeline'
import { WalletHeader } from './wallet-header'
import { WalletPartners } from './wallet-partners'

// Orquestador de la wallet como VISTAS in-place (main → niveles → canjeables),
// no scroll infinito ni navegación por rutas. Funciona igual standalone (/c/[token])
// y embebida en el sheet de la carta (que no puede navegar). Al cambiar de vista
// resetea el scroll del contenedor (window o cuerpo del sheet).

type View = 'main' | 'niveles' | 'canjeables'

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
  const rootRef = useRef<HTMLDivElement>(null)

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
    progression,
    partners,
    rewards,
    punchCards,
    visits,
    events,
    ledger,
    redemptions,
    pendingBenefits,
  } = data
  const hasTiers = progression.length > 0
  const hasRewards = rewards.length > 0
  const tierName = tier.current?.name

  return (
    <main className={embedded ? 'bg-transparent' : 'bg-app-gradient min-h-[100dvh]'}>
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
            />
            <TierProgression progression={progression} variant="full" />
            <WalletPartners partners={partners} />
          </div>
        ) : view === 'canjeables' ? (
          <div
            key="canjeables"
            className="animate-in fade-in slide-in-from-right-3 flex flex-col gap-6 duration-[var(--duration-slow)]"
          >
            <BackHeader
              title="Catálogo de canje"
              subtitle="Mostrá tu QR en la caja para canjear"
              onBack={() => setView('main')}
            />
            <RewardsGrid rewards={rewards} pointsBalance={customer.pointsBalance} />
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
            />
            <PendingBenefits benefits={pendingBenefits} />
            <TierLadder
              progression={progression}
              tier={tier}
              categoryPoints={customer.categoryPoints}
            />
            <TierProgression
              progression={progression}
              variant="current"
              onMore={hasTiers ? () => setView('niveles') : undefined}
            />
            <RewardsGrid
              rewards={rewards}
              pointsBalance={customer.pointsBalance}
              previewCount={6}
              onMore={hasRewards ? () => setView('canjeables') : undefined}
            />
            <WalletPartners partners={partners} />
            <PunchCards cards={punchCards} />
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
