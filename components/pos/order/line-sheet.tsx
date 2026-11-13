'use client'

import { Check, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetGrabber,
  SheetTitle,
} from '@/components/ui/sheet'
import { cancelItem } from '@/lib/pos/actions'
import { posFont } from '@/lib/pos/font'
import { LINE_WORD, lineState } from '@/lib/pos/order/tickets'
import type { SessionItem } from '@/lib/pos/types'
import { cn } from '@/lib/utils'
import { modifierText } from './ticket-card'
import { useLast } from './use-last'

/**
 * Tocar un renglón que ya se mandó: marcarlo servido, o darlo de baja diciendo por qué.
 *
 * Servir no pregunta nada (se puede corregir). Dar de baja no tiene vuelta: el motivo es la
 * confirmación, y se espera la respuesta antes de tacharlo, porque si cocina ya lo empezó la baja la
 * tiene que dar el encargado y eso lo decide el servidor.
 */

/** Con este motivo, después se ofrece marcar el producto agotado. */
export const REASON_SOLD_OUT = 'No hay más'

export const CANCEL_REASONS = [
  'Error de carga',
  'El cliente cambió de idea',
  'Se demoró',
  REASON_SOLD_OUT,
] as const

export type LineTarget = {
  item: SessionItem
  tanda: number
  /** La tanda ya salió a cocina (si está en espera, no hay nada que servir). */
  fired: boolean
}

export function LineSheet({
  target,
  slug,
  onClose,
  onServe,
  onCancelled,
}: {
  target: LineTarget | null
  slug: string
  onClose: () => void
  onServe: (item: SessionItem) => void
  onCancelled: (item: SessionItem, reason: string) => void
}) {
  const shown = useLast(target)
  const [state, setState] = useState<{
    source: LineTarget | null
    asking: boolean
    busy: string | null
    error: string | null
  }>({ source: null, asking: false, busy: null, error: null })
  if (target !== null && state.source !== target) {
    setState({ source: target, asking: false, busy: null, error: null })
  }

  const cancel = async (reason: string) => {
    if (!target || state.busy) return
    const item = target.item
    setState((s) => ({ ...s, busy: reason, error: null }))
    let result: Awaited<ReturnType<typeof cancelItem>>
    try {
      result = await cancelItem(slug, item.id, reason)
    } catch {
      result = {
        ok: false,
        message: 'No hay señal: la baja no se hizo. Probá de nuevo cuando vuelva.',
        code: 'network',
      }
    }
    if (!result.ok) {
      const message = result.message
      setState((s) => ({ ...s, busy: null, error: message }))
      return
    }
    onCancelled(item, reason)
    onClose()
  }

  const item = shown?.item ?? null
  const status = item ? lineState(item) : 'queued'
  const canServe = Boolean(shown?.fired) && status !== 'served' && status !== 'cancelled'

  return (
    <Sheet
      open={target !== null}
      onOpenChange={(next) => {
        if (!next && !state.busy) onClose()
      }}
    >
      <SheetContent
        side="bottom"
        showClose={false}
        className={cn('pos pos-sheet cmd-sheet', posFont.variable)}
        data-testid="line-sheet"
      >
        <SheetGrabber />
        {shown && item ? (
          <div className="pos-sheet-body cmd-sheet-body">
            <div className="cmd-sheet-head">
              <SheetTitle className="pos-sheet-title cmd-sheet-title">
                {item.quantity} × {item.name}
              </SheetTitle>
              <SheetDescription className="cmd-sheet-sub is-ink">
                Tanda {shown.tanda} · {shown.fired ? LINE_WORD[status] : 'En espera'}
              </SheetDescription>
              {item.modifiers.length > 0 || item.notes ? (
                <p className="cmd-sheet-sub">
                  {[...item.modifiers.map(modifierText), item.notes ? `«${item.notes}»` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              ) : null}
            </div>

            {state.error ? (
              <p className="cmd-sheet-error" role="alert">
                {state.error}
              </p>
            ) : null}

            {state.asking ? (
              <fieldset className="cmd-group" disabled={state.busy !== null}>
                <legend>
                  <span className="pos-sheet-q">¿Por qué se da de baja?</span>
                  <small>Queda anotado quién fue.</small>
                </legend>
                <div className="cmd-reasons">
                  {CANCEL_REASONS.map((reason) => (
                    <button
                      key={reason}
                      type="button"
                      className="cmd-opt"
                      onClick={() => void cancel(reason)}
                      data-testid={`reason-${CANCEL_REASONS.indexOf(reason)}`}
                    >
                      {state.busy === reason ? (
                        <LoaderCircle className="cmd-spin" aria-hidden />
                      ) : null}
                      {reason}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}

            <div className="cmd-sheet-foot">
              {state.asking ? (
                <button
                  type="button"
                  className="pos-btn pos-btn-quiet"
                  onClick={() => setState((s) => ({ ...s, asking: false, error: null }))}
                  disabled={state.busy !== null}
                >
                  No dar de baja
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="pos-btn pos-btn-quiet cmd-danger"
                    onClick={() => setState((s) => ({ ...s, asking: true }))}
                    data-testid="line-cancel"
                  >
                    Dar de baja
                  </button>
                  {canServe ? (
                    <button
                      type="button"
                      className={cn('pos-btn pos-btn-primary', status === 'ready' && 'is-ready')}
                      onClick={() => {
                        onServe(item)
                        onClose()
                      }}
                      data-testid="line-serve"
                    >
                      <Check className="size-5" aria-hidden strokeWidth={3} />
                      Servido
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
