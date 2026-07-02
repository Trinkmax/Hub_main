import { cn } from '@/lib/utils'
import type { WalletData } from '@/lib/wallet/queries'
import { CurrencyCards } from './currency-cards'
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

// Shell de la wallet del cliente (Server Component). Orden pensado para que se
// entienda la dinámica: identidad → las 2 monedas explicadas → recorrido de
// categorías → beneficios por nivel (aspiracional) → catálogo de canje → resto.
// Los datos llegan por props (página pública por token); no se hace fetch acá.

export function WalletShell({
  data,
  qrDataUrl,
  embedded = false,
}: {
  data: WalletData
  qrDataUrl: string
  /** Render embebido en el WalletSheet: el sheet provee el header de identidad
   *  (logo + saludo) y el frame full-screen, así que acá lo omitimos. */
  embedded?: boolean
}): React.JSX.Element {
  const {
    customer,
    tenant,
    tier,
    categoryWindowMonths,
    expiry,
    progression,
    rewards,
    punchCards,
    visits,
    events,
    ledger,
    redemptions,
    pendingBenefits,
  } = data

  return (
    <main
      className={cn(
        'scroll-smooth',
        embedded ? 'bg-transparent' : 'bg-app-gradient min-h-[100dvh]',
      )}
    >
      <div
        className={cn(
          'mx-auto flex max-w-md flex-col gap-6 px-4 pb-16',
          embedded ? 'pt-2' : 'pt-8 sm:pt-12',
        )}
      >
        {!embedded ? <WalletHeader tenant={tenant} firstName={customer.firstName} /> : null}

        <CurrencyCards
          customer={customer}
          tier={tier}
          categoryPoints={customer.categoryPoints}
          pointsBalance={customer.pointsBalance}
          windowMonths={categoryWindowMonths}
          expiry={expiry}
        />

        <PendingBenefits benefits={pendingBenefits} />

        <TierLadder progression={progression} tier={tier} />

        <TierProgression progression={progression} />

        <RewardsGrid rewards={rewards} pointsBalance={customer.pointsBalance} />

        <PunchCards cards={punchCards} />

        <VisitsTimeline visits={visits} />

        <UpcomingEvents events={events} />

        <ReviewCta qrToken={customer.qrToken} />

        <PersonalQr qrDataUrl={qrDataUrl} qrToken={customer.qrToken} />

        <HistoryAccordion redemptions={redemptions} ledger={ledger} />

        <footer className="pt-2 text-center text-[11px] text-muted-foreground">
          <p>Esta pantalla es personal y se actualiza sola.</p>
        </footer>
      </div>
    </main>
  )
}
