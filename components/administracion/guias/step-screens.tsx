'use client'

import { ChevronLeft, ChevronRight, Eye } from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { GuideBlock } from './guide-step'

/**
 * «Qué vas a ver» y «Qué tocás» de un paso, juntos: arriba, las pantallas de ARCA de a una
 * (con «Anterior / Siguiente» y el contador «Pantalla 2 de 5»); abajo, la lista numerada de lo
 * que hay que tocar, siempre entera. Cada renglón que tiene su pantalla trae «Ver pantalla N»,
 * y el renglón de la pantalla que se ve queda resaltado. Así la persona sigue el texto y mira
 * el dibujo que corresponde, sin una página eterna.
 *
 * Accesibilidad: cada maqueta es una imagen con su descripción; el cambio de pantalla se
 * anuncia (`aria-live`) y todas las instrucciones están en el texto.
 */

export type StepScreen = {
  /** Corto, para el contador y el anuncio: «Elegí la SAS». */
  readonly title: string
  /** La maqueta (`<ScreenXxx />`). */
  readonly mock: ReactNode
}

export type StepInstruction = {
  readonly content: ReactNode
  /** La pantalla (índice desde 0) que corresponde a este renglón, si hay. */
  readonly screen?: number
}

export function StepScreens({
  screens,
  instructions,
  seeLabel = 'Qué vas a ver',
  doLabel = 'Qué tocás',
}: {
  screens: readonly StepScreen[]
  instructions: readonly StepInstruction[]
  seeLabel?: string
  doLabel?: string
}) {
  const [index, setIndex] = useState(0)
  // Solo se anuncia al cambiar de pantalla: el contador ya se lee en el orden normal.
  const [announce, setAnnounce] = useState('')
  const viewer = useRef<HTMLDivElement>(null)
  const total = screens.length
  const current = screens[Math.min(index, total - 1)]

  const go = (next: number, focusViewer = false) => {
    const clamped = Math.max(0, Math.min(total - 1, next))
    setIndex(clamped)
    const screen = screens[clamped]
    if (screen) setAnnounce(`Pantalla ${clamped + 1} de ${total}: ${screen.title}`)
    if (focusViewer) {
      viewer.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
      viewer.current?.focus({ preventScroll: true })
    }
  }

  return (
    <>
      {current ? (
        <GuideBlock label={seeLabel}>
          <div
            ref={viewer}
            tabIndex={-1}
            className="space-y-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {total > 1 ? (
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                  <span className="font-medium tabular-nums text-foreground">
                    Pantalla {index + 1} de {total}
                  </span>
                  <span className="text-pretty"> · {current.title}</span>
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-11 md:size-8"
                  disabled={index === 0}
                  onClick={() => go(index - 1)}
                  aria-label="Pantalla anterior"
                >
                  <ChevronLeft className="size-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-11 md:size-8"
                  disabled={index === total - 1}
                  onClick={() => go(index + 1)}
                  aria-label="Pantalla siguiente"
                >
                  <ChevronRight className="size-4" aria-hidden />
                </Button>
              </div>
            ) : null}
            <p className="sr-only" aria-live="polite">
              {announce}
            </p>
            {current.mock}
            {total > 1 ? (
              <div className="flex justify-center gap-1.5" aria-hidden="true">
                {screens.map((s, i) => (
                  <span
                    key={s.title}
                    className={cn(
                      'h-1.5 rounded-full transition-all motion-reduce:transition-none',
                      i === index ? 'w-5 bg-primary' : 'w-1.5 bg-border',
                    )}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </GuideBlock>
      ) : null}
      <GuideBlock label={doLabel}>
        <ol className="space-y-2">
          {instructions.map((item, i) => {
            const shown = item.screen !== undefined && item.screen === index && total > 1
            return (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: lista fija de instrucciones de un paso
                key={i}
                className={cn(
                  'grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 rounded-lg px-2 py-2 transition-colors motion-reduce:transition-none',
                  shown && 'bg-cream-tint',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-7 items-center justify-center rounded-full border text-xs font-semibold tabular-nums',
                    shown
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-secondary/40 text-muted-foreground',
                  )}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 space-y-1.5 pt-0.5">
                  <div className="text-pretty">{item.content}</div>
                  {item.screen !== undefined && total > 1 && !shown ? (
                    <button
                      type="button"
                      onClick={() => go(item.screen ?? 0, true)}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring md:min-h-7"
                    >
                      <Eye className="size-3.5" aria-hidden />
                      Ver pantalla {(item.screen ?? 0) + 1}
                    </button>
                  ) : null}
                  {shown ? (
                    <span className="block text-xs font-medium text-primary">
                      Es la pantalla de arriba
                    </span>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ol>
      </GuideBlock>
    </>
  )
}
