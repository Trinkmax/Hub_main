'use client'

import { ImageOff, Minus, Plus, Sparkles } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import type { ActiveSessionStateData } from '@/lib/m-session/actions'
import { cn } from '@/lib/utils'
import type { CartItem } from './mesa-screen'

type Item = ActiveSessionStateData['menu'][number]['items'][number]

function ARSFormat(cents: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100))
}

/**
 * Devuelve un color de texto legible (blanco o forest) según el contraste del color
 * de fondo dado. Helper liviano: parsea hex `#RRGGBB` y aplica relative-luminance YIQ.
 * Para colores en formato OKLCH/no-hex, asume texto blanco por default.
 */
function pickContrastText(bgHex: string): 'light' | 'dark' {
  if (!bgHex.startsWith('#') || bgHex.length !== 7) return 'light'
  const r = Number.parseInt(bgHex.slice(1, 3), 16)
  const g = Number.parseInt(bgHex.slice(3, 5), 16)
  const b = Number.parseInt(bgHex.slice(5, 7), 16)
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return 'light'
  // YIQ formula
  const yiq = (r * 299 + g * 587 + b * 114) / 1000
  return yiq >= 150 ? 'dark' : 'light'
}

export function ItemDetailSheet({
  item,
  onClose,
  onAdd,
}: {
  item: Item | null
  onClose: () => void
  onAdd: (cartItem: CartItem) => void
}) {
  const [qty, setQty] = useState(1)
  const [notes, setNotes] = useState('')

  // Reseteamos estado cuando cambia el item (o cuando se abre uno nuevo)
  useEffect(() => {
    if (item) {
      setQty(1)
      setNotes('')
    }
  }, [item])

  const open = item !== null
  const total = item ? item.price_cents * qty : 0

  const handleAdd = () => {
    if (!item) return
    onAdd({
      menuItemId: item.id,
      name: item.name,
      unitPriceCents: item.price_cents,
      quantity: qty,
      notes: notes.trim().length > 0 ? notes.trim() : null,
    })
    onClose()
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="max-h-[92dvh] gap-0 rounded-t-3xl border-t-0 p-0"
        aria-describedby={undefined}
      >
        <AnimatePresence>
          {item && (
            <motion.div
              key={item.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex h-full flex-col"
            >
              {/* HERO IMAGE con overlay */}
              <div className="relative aspect-[4/3] w-full overflow-hidden bg-secondary/40">
                {item.image_url ? (
                  <Image
                    src={item.image_url}
                    alt={item.name}
                    fill
                    sizes="(max-width: 640px) 100vw, 640px"
                    className="object-cover"
                    unoptimized
                    priority
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
                    <ImageOff className="size-12" aria-hidden />
                  </div>
                )}
                {/* Gradient overlay bottom para legibilidad de badges */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-background via-background/60 to-transparent"
                />
                {/* Tags y +pts encima de la imagen */}
                {(item.tags.length > 0 || item.points_override != null) && (
                  <div className="absolute inset-x-0 bottom-0 flex flex-wrap gap-1.5 px-5 pb-3">
                    {item.tags.map((tag) => {
                      const tone = pickContrastText(tag.color)
                      return (
                        <span
                          key={tag.id}
                          className={cn(
                            'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium shadow-sm',
                            tone === 'light' ? 'text-white' : 'text-foreground',
                          )}
                          style={{ backgroundColor: tag.color }}
                        >
                          {tag.name}
                        </span>
                      )
                    })}
                    {item.points_override != null && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warning/95 px-2.5 py-0.5 text-[11px] font-semibold text-warning-foreground shadow-sm">
                        <Sparkles className="size-3" aria-hidden />+{item.points_override} pts
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* CONTENT SCROLL */}
              <div className="flex-1 overflow-y-auto px-5 pt-5 pb-2">
                <h2 className="font-serif text-2xl font-semibold leading-tight tracking-tight text-balance">
                  {item.name}
                </h2>
                {item.description && (
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {item.description}
                  </p>
                )}

                {/* Selector de cantidad */}
                <div className="mt-6 flex items-center justify-between rounded-2xl border border-border/60 bg-card/60 px-3 py-2.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Cantidad
                  </span>
                  <div className="flex items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-10 rounded-full"
                      onClick={() => setQty(Math.max(1, qty - 1))}
                      disabled={qty <= 1}
                      aria-label="Disminuir cantidad"
                    >
                      <Minus className="size-4" />
                    </Button>
                    <span className="min-w-[2ch] text-center font-serif text-[28px] font-semibold tabular-nums leading-none">
                      {qty}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-10 rounded-full"
                      onClick={() => setQty(Math.min(50, qty + 1))}
                      disabled={qty >= 50}
                      aria-label="Aumentar cantidad"
                    >
                      <Plus className="size-4" />
                    </Button>
                  </div>
                </div>

                {/* Notas */}
                <div className="mt-4 space-y-1.5">
                  <label
                    htmlFor="item-notes"
                    className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    Aclaraciones <span className="font-normal normal-case">(opcional)</span>
                  </label>
                  <Textarea
                    id="item-notes"
                    placeholder="Sin cebolla, bien frío, sin TACC…"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    maxLength={200}
                    rows={3}
                    className="resize-none rounded-xl"
                  />
                </div>
              </div>

              {/* CTA STICKY */}
              <div className="sticky bottom-0 border-t border-border/60 bg-background/95 px-5 pt-3 pb-[max(env(safe-area-inset-bottom),12px)] backdrop-blur">
                <Button
                  onClick={handleAdd}
                  className="h-13 w-full gap-2 rounded-xl text-base font-semibold"
                  size="xl"
                >
                  <span>Agregar al pedido</span>
                  <span className="mx-1 opacity-50">·</span>
                  <span className="tabular-nums">{ARSFormat(total)}</span>
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </SheetContent>
    </Sheet>
  )
}
