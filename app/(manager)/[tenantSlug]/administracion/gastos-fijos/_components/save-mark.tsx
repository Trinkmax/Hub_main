'use client'

import { LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * La marca de lo que se guarda solo (un renglón de la planilla): «Guardando…»,
 * «Guardado» con su tilde que se dibuja, o «No se guardó» con «Reintentar».
 * Avisa a los lectores sin interrumpir (`aria-live="polite"`).
 *
 * «Guardado» se apaga solo a los 2 s; con `persist` se queda (en «Completar la
 * planilla» los renglones ya completados conservan su tilde hasta salir).
 *
 * Cuándo NO: para un formulario con botón de guardar (ahí el botón dice
 * «Guardando…») ni para un error que frena la pantalla (eso es un aviso).
 */

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const FADE_MS = 2000

export function SaveMark({
  state,
  message,
  onRetry,
  retryLabel = 'Reintentar',
  persist = false,
  className,
}: {
  state: SaveState
  /** Con `error`: qué pasó («No se guardó», «Alguien lo cambió recién.»). */
  message?: string
  onRetry?: () => void
  retryLabel?: string
  /** «Guardado» no se apaga. */
  persist?: boolean
  className?: string
}) {
  // «Guardado» se muestra un rato y se va: lo que importa quedó en el campo.
  const [faded, setFaded] = useState(false)
  useEffect(() => {
    setFaded(false)
    if (state !== 'saved' || persist) return
    const timer = window.setTimeout(() => setFaded(true), FADE_MS)
    return () => window.clearTimeout(timer)
  }, [state, persist])

  const shown = state === 'saved' && faded ? 'idle' : state

  return (
    <span
      aria-live="polite"
      data-save={shown}
      className={cn(
        'inline-flex min-h-6 items-center gap-1 text-xs',
        shown === 'error' ? 'text-destructive' : 'text-muted-foreground',
        className,
      )}
    >
      {shown === 'saving' ? (
        <>
          <LoaderCircle aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
          Guardando…
        </>
      ) : null}
      {shown === 'saved' ? (
        <>
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            className="size-3.5 text-success"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3.5 8.5l3 3 6-7" className="adm-tick adm-tick-draw" />
          </svg>
          <span className="text-foreground">Guardado</span>
        </>
      ) : null}
      {shown === 'error' ? (
        <>
          <span className="text-pretty">{message ?? 'No se guardó'}</span>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex min-h-6 items-center rounded-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
            >
              {retryLabel}
            </button>
          ) : null}
        </>
      ) : null}
    </span>
  )
}
