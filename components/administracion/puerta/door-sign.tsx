import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

/**
 * El cartel colgado en la puerta: una placa de papel con UNA palabra
 * («PRIVADO», «PRONTO», «APAGADA», «SOLO LECTURA»), colgada de un clavo con un
 * cordón corto. Es lo que ve quien no puede entrar a Administración, o quien
 * entra a una pantalla de carga en modo lectura: dice qué pasa antes de que
 * lea la oración de abajo.
 *
 * Es papel, así que es claro también en modo oscuro (misma receta que
 * `PaperSheet`: la tinta va en línea). Quieto: no se balancea ni entra con
 * animación. Es un cartel, no un sello: no dice el estado de un comprobante.
 *
 * Cuándo NO: para un estado dentro de una pantalla (eso es `StatusPill`), ni
 * más de uno a la vista. La palabra va siempre con su título y su oración al
 * lado: el cartel solo no explica nada.
 */

const PAPER_INK = {
  '--foreground': 'var(--adm-paper-ink)',
  '--muted-foreground': 'color-mix(in oklch, var(--adm-paper-ink) 68%, var(--adm-paper))',
} as CSSProperties

export function DoorSign({ word, className }: { word: string; className?: string }) {
  return (
    <div
      role="img"
      aria-label={`Cartel: ${word}`}
      className={cn('inline-flex flex-col items-center', className)}
    >
      {/* El clavo y el cordón: dos hilos que bajan hasta los ojales de la placa. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 56 30"
        className="h-[30px] w-14 text-muted-foreground"
        fill="none"
      >
        <path
          d="M28 5 L8 30 M28 5 L48 30"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          opacity="0.75"
        />
        <circle cx="28" cy="5" r="3" className="fill-adm-gold" />
        <circle cx="28" cy="5" r="3" stroke="currentColor" strokeWidth="1" opacity="0.55" />
      </svg>
      <div
        style={PAPER_INK}
        className={cn(
          'force-light relative -mt-1 rounded-md border border-adm-paper-rule bg-adm-paper p-1 text-adm-paper-ink',
          // Colgada delante de la pared: una sombra corta y una larga, de la tinta del papel.
          'shadow-[0_1px_1px_color-mix(in_oklch,var(--adm-paper-ink)_12%,transparent),0_12px_20px_-10px_color-mix(in_oklch,var(--adm-paper-ink)_28%,transparent)]',
        )}
      >
        {/* Los dos ojales por donde pasa el cordón. */}
        <span
          aria-hidden
          className="absolute top-1.5 left-1/2 size-1.5 -translate-x-[22px] rounded-full bg-adm-paper-ink/30"
        />
        <span
          aria-hidden
          className="absolute top-1.5 left-1/2 size-1.5 translate-x-[16px] rounded-full bg-adm-paper-ink/30"
        />
        <div className="rounded-[5px] border border-adm-paper-ink/55 px-7 pt-4 pb-3">
          <p className="font-serif text-2xl leading-none font-semibold tracking-[0.16em] whitespace-nowrap uppercase">
            {word}
          </p>
        </div>
      </div>
    </div>
  )
}
