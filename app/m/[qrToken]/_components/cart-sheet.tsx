'use client'

import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { submitTicket } from '@/lib/m-session/actions'
import type { CartItem } from './mesa-screen'

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
  const total = cart.reduce((sum, c) => sum + c.unitPriceCents * c.quantity, 0)

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
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Tu carrito</SheetTitle>
        </SheetHeader>
        <div className="mt-4 max-h-[50vh] space-y-3 overflow-y-auto px-4">
          {cart.length === 0 && (
            <p className="text-center text-sm text-muted-foreground">El carrito está vacío.</p>
          )}
          {cart.map((c, i) => (
            <div
              key={`${c.menuItemId}::${c.notes ?? ''}`}
              className="flex items-start gap-3 rounded-lg border p-3"
            >
              <div className="flex-1">
                <p className="font-medium">{c.name}</p>
                {c.notes && <p className="text-xs text-muted-foreground">{c.notes}</p>}
                <p className="mt-1 text-xs text-muted-foreground">
                  ${(c.unitPriceCents / 100).toFixed(2)} c/u
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Input
                  type="number"
                  min={0}
                  max={50}
                  value={c.quantity}
                  onChange={(e) =>
                    onUpdate(i, {
                      quantity: Math.max(0, Math.min(50, Number(e.target.value) || 0)),
                    })
                  }
                  className="w-16 text-center"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onUpdate(i, { quantity: 0 })}
                  className="h-6 px-2"
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
        {error && <p className="mt-2 px-4 text-sm text-destructive">{error}</p>}
        <SheetFooter className="mt-4">
          <div className="flex w-full items-center justify-between gap-3">
            <span className="font-display text-lg font-semibold">${(total / 100).toFixed(2)}</span>
            <Button onClick={handleSubmit} disabled={pending || cart.length === 0}>
              {pending ? 'Enviando…' : 'Realizar orden'}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
