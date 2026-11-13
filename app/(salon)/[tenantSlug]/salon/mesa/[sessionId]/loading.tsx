import { ChevronLeft } from 'lucide-react'
import { PosTopbar } from '@/components/pos/ui/pos-topbar'
import { posFont } from '@/lib/pos/font'
import { cn } from '@/lib/utils'
import '@/components/pos/order/order.css'

/**
 * Mientras llega la mesa: la misma pantalla, en silueta. Quieta: es una pantalla que se abre cien
 * veces por noche y lo que tarda es un instante.
 */
export default function PosOrderLoading() {
  return (
    <div className={cn('pos', posFont.variable)}>
      <div className="cmd cmd-skeleton" data-picker="closed" data-slot="skeleton" aria-busy="true">
        <PosTopbar>
          <span className="cmd-back" aria-hidden>
            <ChevronLeft strokeWidth={2.4} />
          </span>
          <span className="cmd-title">Mesa</span>
          <span className="sr-only">Abriendo la mesa…</span>
        </PosTopbar>
        <div className="cmd-main">
          <div className="cmd-scroll">
            <div className="cmd-flow" aria-hidden>
              <div className="cmd-ticket cmd-ghost" />
              <div className="cmd-ticket cmd-ghost is-short" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
