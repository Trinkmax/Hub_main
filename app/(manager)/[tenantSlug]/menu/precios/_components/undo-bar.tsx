'use client'

import { CircleCheck, LoaderCircle, TriangleAlert, X } from 'lucide-react'
import { type RefObject, useState } from 'react'
import { Button } from '@/components/ui/button'
import { batchFailureSentence, batchSentence, type PriceBatch } from '@/lib/menu/prices/batch'
import { cn } from '@/lib/utils'

const two = (value: number) => String(value).padStart(2, '0')

/** «a las 23:40», o con la fecha si no fue hoy. Solo en el navegador (usa su reloj). */
function whenText(at: number): string {
  const date = new Date(at)
  const now = new Date()
  const time = `${two(date.getHours())}:${two(date.getMinutes())}`
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  return sameDay
    ? `a las ${time}`
    : `el ${two(date.getDate())}/${two(date.getMonth() + 1)} a las ${time}`
}

/**
 * El aviso que queda después de un aumento: qué se hizo y «Deshacer». No se va solo: se queda
 * hasta que la persona lo cierre o deshaga, también si recarga la página. Deshacer pide una
 * confirmación en el lugar (son muchos precios de un toque), sin abrir nada encima.
 */
export function UndoBar({
  batch,
  busy,
  barRef,
  onUndo,
  onDismiss,
}: {
  batch: PriceBatch
  /** Se está deshaciendo. */
  busy: boolean
  barRef: RefObject<HTMLElement | null>
  onUndo: () => void
  onDismiss: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const failure = batchFailureSentence(batch)
  const partial = failure !== null
  const prices = batch.changes.length

  return (
    <section
      ref={barRef}
      tabIndex={-1}
      aria-label="El último aumento"
      data-testid="undo-bar"
      className={cn(
        'flex flex-col gap-3 rounded-2xl border px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center',
        partial ? 'border-warning/50 bg-warning/10' : 'border-success/35 bg-success/10',
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        {partial ? (
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-text" />
        ) : (
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
        )}
        <div role="status" className="min-w-0 space-y-1 text-sm">
          {confirming ? (
            <p className="font-medium text-pretty">
              {prices === 1
                ? '¿Volvemos ese precio a como estaba?'
                : `¿Volvemos esos ${prices} precios a como estaban?`}
            </p>
          ) : (
            <>
              <p className="text-pretty">
                <span className="font-medium">{batchSentence(batch)}</span>{' '}
                <span className="text-foreground/75">{whenText(batch.at)}.</span>
              </p>
              {failure ? <p className="text-pretty">{failure}</p> : null}
            </>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
        {confirming ? (
          <>
            <Button
              type="button"
              data-testid="undo-confirm"
              className="h-11 sm:h-9"
              disabled={busy}
              onClick={onUndo}
            >
              {busy ? (
                <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
              ) : null}
              {busy ? 'Deshaciendo…' : 'Sí, deshacer'}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 sm:h-9"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              No
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              data-testid="undo-open"
              className="h-11 sm:h-9"
              onClick={() => setConfirming(true)}
            >
              Deshacer
            </Button>
            <button
              type="button"
              data-testid="undo-dismiss"
              aria-label="Cerrar este aviso (los precios quedan como están)"
              onClick={onDismiss}
              className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-background/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-11"
            >
              <X aria-hidden className="size-4" />
            </button>
          </>
        )}
      </div>
    </section>
  )
}
