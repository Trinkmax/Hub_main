import type { WalletData } from '@/lib/wallet/queries'
import { HistoryAccordion } from './history-accordion'
import { PendingBenefits } from './pending-benefits'
import { PersonalQr } from './personal-qr'
import { PunchCards } from './punch-cards'
import { ReviewCta } from './review-cta'
import { RewardsGrid } from './rewards-grid'
import { TierHero } from './tier-hero'
import { UpcomingEvents } from './upcoming-events'
import { VisitsTimeline } from './visits-timeline'
import { WalletHeader } from './wallet-header'

// Shell de la wallet del cliente (Server Component). Compone las secciones en
// orden de valor: identidad → progreso → beneficios pendientes → canjeables →
// tarjetas → visitas → eventos → QR → historial. Los datos llegan por props
// (página pública por token de capacidad); no se hace fetch acá.

export function WalletShell({
  data,
  qrDataUrl,
}: {
  data: WalletData
  qrDataUrl: string
}): React.JSX.Element {
  const {
    customer,
    tenant,
    tier,
    rewards,
    punchCards,
    visits,
    events,
    ledger,
    redemptions,
    pendingBenefits,
  } = data

  return (
    <main className="bg-app-gradient min-h-[100dvh]">
      <div className="mx-auto flex max-w-md flex-col gap-6 px-4 pb-16 pt-8 sm:pt-12">
        <WalletHeader tenant={tenant} firstName={customer.firstName} />

        <TierHero
          tier={tier}
          pointsBalance={customer.pointsBalance}
          lifetimePoints={customer.lifetimePoints}
        />

        <PendingBenefits benefits={pendingBenefits} />

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
