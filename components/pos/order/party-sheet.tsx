'use client'

import { Minus, Plus } from 'lucide-react'
import { useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetGrabber,
  SheetTitle,
} from '@/components/ui/sheet'
import { posFont } from '@/lib/pos/font'
import { cn } from '@/lib/utils'

/**
 * Cuántos son en la mesa (y a nombre de quién). Se abre tocando «×4» arriba. Cualquier forma de
 * cerrar guarda: no hay nada que perder y se puede volver a cambiar.
 */
export function PartySheet({
  open,
  title,
  capacity,
  partySize,
  alias,
  onClose,
  onSave,
}: {
  open: boolean
  title: string
  capacity: number | null
  partySize: number | null
  alias: string | null
  onClose: () => void
  onSave: (change: { partySize?: number; alias?: string }) => void
}) {
  // Cada vez que se abre arranca de lo que la mesa tiene en ese momento (`from`), y al cerrar se
  // guarda solo lo que el mozo cambió: abrir y cerrar no toca la mesa, ni pisa lo que cambió otro.
  const start = () => ({ count: partySize ?? 2, name: alias ?? '' })
  const [form, setForm] = useState(() => ({ open: false, from: start(), ...start() }))
  if (open !== form.open) {
    setForm(open ? { open, from: start(), ...start() } : { ...form, open: false })
  }

  const close = () => {
    const change: { partySize?: number; alias?: string } = {}
    if (form.count !== form.from.count) change.partySize = form.count
    const name = form.name.trim().slice(0, 60)
    if (name !== form.from.name) change.alias = name
    if (change.partySize !== undefined || change.alias !== undefined) onSave(change)
    onClose()
  }

  const over = capacity !== null && form.count > capacity

  return (
    <Sheet open={open} onOpenChange={(next) => !next && close()}>
      <SheetContent
        side="bottom"
        showClose={false}
        className={cn('pos pos-sheet cmd-sheet', posFont.variable)}
        data-testid="party-sheet"
      >
        <SheetGrabber />
        <form
          className="pos-sheet-body cmd-sheet-body"
          onSubmit={(event) => {
            event.preventDefault()
            close()
          }}
        >
          <div className="cmd-sheet-head">
            <SheetTitle className="pos-sheet-title cmd-sheet-title">¿Cuántos son?</SheetTitle>
            <SheetDescription className="cmd-sheet-sub is-ink">
              {title}
              {capacity ? ` · entran ${capacity}` : ''}
              {over ? ' · van a estar apretados' : ''}
            </SheetDescription>
          </div>

          <div className="cmd-party">
            <button
              type="button"
              className="pos-step"
              onClick={() => setForm((f) => ({ ...f, count: Math.max(1, f.count - 1) }))}
              disabled={form.count <= 1}
              aria-label="Uno menos"
              data-testid="party-minus"
            >
              <Minus className="size-6" aria-hidden />
            </button>
            <output className="pos-step-value" aria-live="polite" aria-label="Personas">
              {form.count}
            </output>
            <button
              type="button"
              className="pos-step"
              onClick={() => setForm((f) => ({ ...f, count: Math.min(100, f.count + 1) }))}
              disabled={form.count >= 100}
              aria-label="Uno más"
              data-testid="party-plus"
            >
              <Plus className="size-6" aria-hidden />
            </button>
          </div>

          <div className="cmd-field">
            <label htmlFor="cmd-alias-input">A nombre de</label>
            <input
              id="cmd-alias-input"
              className="cmd-input"
              type="text"
              value={form.name}
              maxLength={60}
              onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
              placeholder="Si querés, un nombre para ubicarla"
              enterKeyHint="done"
              autoComplete="off"
              autoCapitalize="words"
            />
          </div>

          <div className="cmd-sheet-foot">
            <button type="submit" className="pos-btn pos-btn-primary" data-testid="party-done">
              Listo
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
