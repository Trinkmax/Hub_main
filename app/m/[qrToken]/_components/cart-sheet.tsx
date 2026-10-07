'use client'

import { Minus, Plus, ShoppingBag, Trash2, Utensils } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetGrabber } from '@/components/ui/sheet'
import { submitTicket } from '@/lib/m-session/actions'
import type { CartItem } from './mesa-screen'
import { useDismissOnBack } from './use-dismiss-on-back'

function ARSFormat(cents: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100))
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function CartSheet({
  qrToken,
  browserToken,
  cart,
  onUpdate,
  onClose,
  onSubmitted,
}: {
  qrToken: string
  browserToken: string
  cart: CartItem[]
  onUpdate: (index: number, patch: Partial<CartItem>) => void
  onClose: () => void
  onSubmitted: () => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useDismissOnBack(true, onClose)
  const total = cart.reduce((sum, c) => sum + c.unitPriceCents * c.quantity, 0)
  const itemCount = cart.reduce((sum, c) => sum + c.quantity, 0)

  const handleSubmit = async () => {
    if (cart.length === 0) return
    setPending(true)
    setError(null)
    const result = await submitTicket({
      qrToken,
      browserToken,
      items: cart.map((c) => ({
        menu_item_id: c.menuItemId,
        quantity: c.quantity,
        notes: c.notes,
        assigned_to_guest_id: null,
      })),
      idempotencyKey: generateIdempotencyKey(),
    })
    setPending(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    onSubmitted()
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="max-h-[88dvh] gap-0 rounded-t-3xl border-t-0 p-0"
        aria-describedby={undefined}
      >
        <SheetGrabber />
        <div className="flex h-full flex-col">
          {/* HEADER */}
          <div className="border-b border-border/60 px-5 pt-5 pb-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Tu pedido
            </p>
            <h2 className="mt-0.5 font-serif text-2xl font-semibold leading-tight tracking-tight">
              {cart.length === 0
                ? 'Carrito vacío'
                : `${itemCount} ${itemCount === 1 ? 'ítem' : 'ítems'}`}
            </h2>
          </div>

          {/* LIST */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                <span className="flex size-14 items-center justify-center rounded-full bg-secondary/60 text-muted-foreground">
                  <ShoppingBag className="size-6" aria-hidden />
                </span>
                <p className="text-sm font-medium">No hay nada en tu pedido todavía</p>
                <p className="max-w-[26ch] text-xs text-muted-foreground">
                  Andá a la carta y agregá lo que quieras pedir.
                </p>
              </div>
            ) : (
              <ul className="space-y-2.5">
                {cart.map((c, i) => (
                  <li
                    key={`${c.menuItemId}::${c.notes ?? ''}`}
                    className="card-hairline flex items-start gap-3 rounded-2xl border border-border/60 bg-card p-3 shadow-sm"
                  >
                    <span
                      aria-hidden
                      className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-secondary/60 text-muted-foreground"
                    >
                      <Utensils className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-1 font-medium leading-tight">{c.name}</p>
                      {c.notes && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {c.notes}
                        </p>
                      )}
                      <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                        {ARSFormat(c.unitPriceCents)} c/u
                      </p>
                      {/* Cantidad selector compacto */}
                      <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/40 p-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 rounded-full"
                          onClick={() => onUpdate(i, { quantity: Math.max(0, c.quantity - 1) })}
                          aria-label="Disminuir cantidad"
                        >
                          <Minus className="size-3.5" />
                        </Button>
                        <span className="min-w-[1.5ch] text-center text-sm font-semibold tabular-nums">
                          {c.quantity}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 rounded-full"
                          onClick={() => onUpdate(i, { quantity: Math.min(50, c.quantity + 1) })}
                          aria-label="Aumentar cantidad"
                        >
                          <Plus className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className="font-serif text-base font-semibold tabular-nums">
                        {ARSFormat(c.unitPriceCents * c.quantity)}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground hover:text-destructive"
                        onClick={() => onUpdate(i, { quantity: 0 })}
                        aria-label={`Eliminar ${c.name}`}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {error && (
              <p
                role="alert"
                className="mt-3 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
              >
                {error}
              </p>
            )}
          </div>

          {/* FOOTER */}
          {cart.length > 0 && (
            <div className="sticky bottom-0 border-t border-border/60 bg-background/95 px-5 pt-3 pb-[max(env(safe-area-inset-bottom),12px)] backdrop-blur">
              <div className="mb-3 flex items-baseline justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Total
                </span>
                <span className="font-serif text-2xl font-semibold tabular-nums">
                  {ARSFormat(total)}
                </span>
              </div>
              <Button
                onClick={handleSubmit}
                disabled={pending}
                size="xl"
                className="w-full rounded-xl font-semibold"
              >
                {pending ? 'Enviando…' : 'Enviar pedido'}
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
