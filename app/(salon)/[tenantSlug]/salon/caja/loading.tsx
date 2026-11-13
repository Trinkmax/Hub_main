import { PosTopbar } from '@/components/pos/ui/pos-topbar'
import { posFont } from '@/lib/pos/font'
import { cn } from '@/lib/utils'
import '@/components/pos/cash/cash.css'

/**
 * Mientras llega la caja: la misma pantalla, en silueta (el visor, la ranura y el papel). Quieta: es
 * una pantalla que se abre muchas veces por noche y lo que tarda es un instante.
 */
export default function PosCashLoading() {
  return (
    <div className={cn('pos', posFont.variable)}>
      <div className="caja" data-slot="skeleton" aria-busy="true">
        <PosTopbar>
          <div className="caja-title">
            <b>Caja</b>
          </div>
          <span className="sr-only" role="status">
            Abriendo la caja…
          </span>
        </PosTopbar>
        <div className="caja-scroll" aria-hidden>
          <section className="caja-desk">
            <div className="caja-display">
              <div className="caja-ghost-num" />
              <div className="caja-ghost-say" />
            </div>
          </section>
          <section className="caja-roll">
            <div className="caja-slot" />
            <div className="caja-tape caja-ghost" />
          </section>
        </div>
      </div>
    </div>
  )
}
