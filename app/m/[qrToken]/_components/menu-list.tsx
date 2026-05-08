'use client'

import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import type { SessionStateData } from '@/lib/m-session/actions'
import type { CartItem } from './mesa-screen'

type Category = SessionStateData['menu'][number]
type Item = Category['items'][number]

export function MenuList({
  categories,
  onAdd,
}: {
  categories: Category[]
  onAdd: (item: CartItem) => void
}) {
  const [opening, setOpening] = useState<Item | null>(null)
  const [qty, setQty] = useState(1)
  const [notes, setNotes] = useState('')

  const reset = () => {
    setQty(1)
    setNotes('')
    setOpening(null)
  }

  const handleAdd = () => {
    if (!opening) return
    onAdd({
      menuItemId: opening.id,
      name: opening.name,
      unitPriceCents: opening.price_cents,
      quantity: qty,
      notes: notes.trim().length > 0 ? notes.trim() : null,
    })
    reset()
  }

  return (
    <div className="space-y-6">
      {categories.map((cat) => (
        <section key={cat.id}>
          <h2 className="font-display text-base font-semibold tracking-tight">{cat.name}</h2>
          <div className="mt-2 space-y-2">
            {cat.items.map((it) => (
              <button
                key={it.id}
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-xl border bg-card p-3 text-left shadow-sm hover:bg-card/95"
                onClick={() => setOpening(it)}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{it.name}</p>
                  {it.description && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">{it.description}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-sm font-semibold">
                    ${(it.price_cents / 100).toFixed(2)}
                  </span>
                  <Plus className="size-4 text-primary" />
                </div>
              </button>
            ))}
            {cat.items.length === 0 && (
              <p className="text-xs text-muted-foreground">Sin ítems en esta categoría.</p>
            )}
          </div>
        </section>
      ))}

      <Sheet open={Boolean(opening)} onOpenChange={(o) => !o && reset()}>
        <SheetContent side="bottom">
          {opening && (
            <>
              <SheetHeader>
                <SheetTitle>{opening.name}</SheetTitle>
                {opening.description && (
                  <p className="text-sm text-muted-foreground">{opening.description}</p>
                )}
              </SheetHeader>
              <div className="mt-4 space-y-3 px-4 pb-4">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setQty(Math.max(1, qty - 1))}
                  >
                    −
                  </Button>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={qty}
                    onChange={(e) => setQty(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                    className="w-20 text-center"
                  />
                  <Button type="button" size="sm" variant="outline" onClick={() => setQty(qty + 1)}>
                    +
                  </Button>
                  <span className="ml-auto text-sm font-semibold">
                    ${((opening.price_cents * qty) / 100).toFixed(2)}
                  </span>
                </div>
                <Textarea
                  placeholder="Notas (sin cebolla, bien frío…)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={200}
                />
                <Button onClick={handleAdd} className="w-full">
                  Agregar al carrito
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
