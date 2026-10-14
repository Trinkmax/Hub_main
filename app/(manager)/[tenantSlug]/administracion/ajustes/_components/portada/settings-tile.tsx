import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import type { TileState } from '../../_lib/portada'

/**
 * Uno de los seis objetos de la portada de Ajustes: el dibujo del objeto (72
 * px), el nombre de la habitación, UNA oración con el dato y su estado en una
 * palabra. Toda la tarjeta es el link (el estado no es un botón aparte): se
 * levanta al pasar el mouse y se hunde al tocarla.
 *
 * El dibujo es decorativo; lo que dice la tarjeta está en la oración y en la
 * píldora, con palabras.
 *
 * Cuándo NO: fuera de la portada de Ajustes (para una acción grande está
 * `ActionTile`; para una caja, `WalletCard`).
 */
export function SettingsTile({
  href,
  title,
  state,
  art,
  index = 0,
  sentenceTitle,
}: {
  href: string
  /** El nombre de la habitación, igual que en el resto de la app. */
  title: string
  state: TileState
  /** La miniatura del objeto. */
  art: ReactNode
  /** Para la entrada escalonada. */
  index?: number
  /** El texto entero de la oración cuando se corta (la razón social). */
  sentenceTitle?: string
}) {
  return (
    <li className="stagger-item flex" style={{ '--i': index } as CSSProperties}>
      <Link
        href={href}
        className="card-hairline press-lift group grid w-full grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border bg-card p-4 shadow-xs outline-none transition-[border-color,box-shadow] hover:border-primary/30 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring sm:gap-4 sm:p-5"
      >
        <span className="flex h-[72px] w-[72px] items-center justify-center">{art}</span>
        <span className="min-w-0">
          <span className="block font-serif text-lg leading-snug font-semibold tracking-tight">
            {title}
          </span>
          <span
            title={sentenceTitle}
            className="mt-0.5 line-clamp-2 block text-sm leading-snug text-muted-foreground text-pretty"
          >
            {state.sentence}
          </span>
          <span className="mt-2 flex">
            <StatusPill tone={state.pill.tone} className="max-w-full">
              <span className="truncate">{state.pill.text}</span>
            </StatusPill>
          </span>
        </span>
        <ChevronRight
          aria-hidden
          className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
        />
      </Link>
    </li>
  )
}
