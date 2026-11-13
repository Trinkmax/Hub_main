import { ChevronLeft } from 'lucide-react'
import { PosTopbar } from '@/components/pos/ui/pos-topbar'
import { posFont } from '@/lib/pos/font'
import { cn } from '@/lib/utils'
import '@/components/pos/pay/pay.css'

/**
 * Mientras llega la cuenta: la misma pantalla, en silueta. Quieta: lo que tarda es un instante.
 */
export default function PosBillLoading() {
  return (
    <div className={cn('pos', posFont.variable)}>
      <div className="pay pay-skeleton" data-slot="skeleton" aria-busy="true">
        <PosTopbar>
          <span className="pay-back" aria-hidden>
            <ChevronLeft strokeWidth={2.4} />
          </span>
          <span className="pay-title">Cuenta</span>
          <span className="sr-only">Abriendo la cuenta…</span>
        </PosTopbar>
        <div className="pay-body" aria-hidden>
          <div className="pay-falta">
            <p className="pay-falta-main">
              <span className="pay-falta-word">Falta</span>
            </p>
          </div>
          <div className="pay-main">
            <div className="pay-scroll">
              <div className="pay-flow">
                <div className="pay-paper pay-ghost" />
              </div>
            </div>
          </div>
          <div className="pay-dock-edge" />
          <div className="pay-dock pay-ghost-dock" />
        </div>
      </div>
    </div>
  )
}
