'use client'

import { Minus, PencilLine, Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetGrabber,
  SheetTitle,
} from '@/components/ui/sheet'
import { formatCentsShort } from '@/lib/money/format'
import { posFont } from '@/lib/pos/font'
import { type DraftLine, MAX_NOTE, MAX_OPTIONS, MAX_QUANTITY } from '@/lib/pos/order/cart'
import {
  type MenuIndex,
  missingRequired,
  modifierGroupsFor,
  toggleOption,
  validOptionIds,
} from '@/lib/pos/order/menu-index'
import type { MenuItem, ModifierGroup } from '@/lib/pos/types'
import { cn } from '@/lib/utils'
import { modifierText } from './ticket-card'
import { useLast } from './use-last'

/**
 * Las aclaraciones de un producto: fichas para tocar, nunca escribir primero. Una sola elección se
 * comporta como radio; varias, como interruptores. Lo último, y solo si hace falta, una nota corta.
 *
 * Dos usos: antes de agregar un producto que obliga a elegir algo (ahí el botón dice «Agregar» y
 * cerrar la hoja no agrega nada) y al tocar un renglón sin enviar (ahí cualquier forma de cerrar
 * guarda lo elegido: no hay nada que perder).
 */

export type OptionsTarget =
  | { mode: 'add'; item: MenuItem }
  | { mode: 'edit'; line: DraftLine; name: string }

export type OptionsChoice = { quantity: number; option_ids: string[]; notes: string | null }

type Form = {
  /** De qué apertura es este formulario: cada vez que se abre la hoja, arranca limpio. */
  source: OptionsTarget | null
  optionIds: string[]
  note: string
  noteOpen: boolean
  quantity: number
}

function menuItemId(target: OptionsTarget): string {
  return target.mode === 'add' ? target.item.id : target.line.menu_item_id
}

function startForm(target: OptionsTarget, index: MenuIndex): Form {
  const groups = modifierGroupsFor(index, menuItemId(target))
  if (target.mode === 'add') {
    return { source: target, optionIds: [], note: '', noteOpen: false, quantity: 1 }
  }
  return {
    source: target,
    optionIds: validOptionIds(index, target.line.menu_item_id, target.line.option_ids),
    note: target.line.notes ?? '',
    // Sin fichas para elegir, lo único que se puede hacer acá es escribir.
    noteOpen: Boolean(target.line.notes) || groups.length === 0,
    quantity: target.line.quantity,
  }
}

export function OptionsSheet({
  target,
  index,
  onClose,
  onAdd,
  onSave,
}: {
  target: OptionsTarget | null
  index: MenuIndex
  onClose: () => void
  onAdd: (item: MenuItem, choice: OptionsChoice) => void
  onSave: (lineKey: string, choice: OptionsChoice) => void
}) {
  const shown = useLast(target)
  const [form, setForm] = useState<Form>({
    source: null,
    optionIds: [],
    note: '',
    noteOpen: false,
    quantity: 1,
  })
  if (target !== null && form.source !== target) setForm(startForm(target, index))

  const itemId = shown ? menuItemId(shown) : null
  const item = itemId ? (index.items.get(itemId) ?? null) : null
  const groups = itemId ? modifierGroupsFor(index, itemId) : []
  const missing = itemId ? missingRequired(index, itemId, form.optionIds) : []
  const unit =
    (item?.price_cents ?? 0) +
    form.optionIds.reduce((sum, id) => sum + (index.options.get(id)?.option.delta_cents ?? 0), 0)
  const choice: OptionsChoice = {
    quantity: form.quantity,
    option_ids: form.optionIds,
    notes: form.note.trim() || null,
  }

  const toggle = (group: ModifierGroup, optionId: string) => {
    if (toggleOption(group, form.optionIds, optionId).length > MAX_OPTIONS) {
      toast.error('Son demasiadas aclaraciones para un solo producto.')
      return
    }
    // Sobre lo último que haya: dos fichas tocadas casi a la vez no se pisan.
    setForm((f) => {
      const next = toggleOption(group, f.optionIds, optionId)
      return next.length > MAX_OPTIONS ? f : { ...f, optionIds: next }
    })
  }

  const close = () => {
    // Editando un renglón, cerrar es guardar.
    if (target?.mode === 'edit') onSave(target.line.key, choice)
    onClose()
  }
  const confirm = () => {
    if (!target) return
    if (target.mode === 'edit') {
      close()
      return
    }
    if (missing.length > 0) return
    onAdd(target.item, choice)
    onClose()
  }

  const title = shown ? (shown.mode === 'add' ? shown.item.name : shown.name) : ''
  const adding = shown?.mode === 'add'

  return (
    <Sheet open={target !== null} onOpenChange={(next) => !next && close()}>
      <SheetContent
        side="bottom"
        showClose={false}
        className={cn('pos pos-sheet cmd-sheet', posFont.variable)}
        data-testid="options-sheet"
      >
        <SheetGrabber />
        {shown ? (
          <>
            <form
              className="pos-sheet-body cmd-sheet-body has-foot"
              onSubmit={(event) => {
                event.preventDefault()
                confirm()
              }}
            >
              <div className="cmd-sheet-head">
                <SheetTitle className="pos-sheet-title cmd-sheet-title">{title}</SheetTitle>
                <SheetDescription className="cmd-sheet-sub">
                  {item ? formatCentsShort(unit) : 'Ya no está en la carta'}
                  {item && form.quantity > 1 ? ' cada uno' : ''}
                </SheetDescription>
              </div>

              {groups.map((group) => {
                const need = missing.some((g) => g.id === group.id)
                return (
                  <fieldset key={group.id} className="cmd-group">
                    <legend>
                      <span className="pos-sheet-q">{group.name}</span>
                      <small className={need ? 'is-need' : undefined}>
                        {group.required
                          ? need
                            ? 'Elegí uno para seguir'
                            : 'Elegido'
                          : group.selection === 'single'
                            ? 'Uno, si hace falta'
                            : 'Los que hagan falta'}
                      </small>
                    </legend>
                    <div className="cmd-opts">
                      {group.options.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className="cmd-opt"
                          aria-pressed={form.optionIds.includes(option.id)}
                          onClick={() => toggle(group, option.id)}
                          data-testid={`opt-${option.id}`}
                        >
                          {option.label}
                          {option.delta_cents !== 0 ? (
                            <small>
                              {modifierText({ label: '', delta_cents: option.delta_cents }).trim()}
                            </small>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                )
              })}

              {form.noteOpen ? (
                <div className="cmd-field">
                  <label htmlFor="cmd-note-input">Otra aclaración</label>
                  <input
                    id="cmd-note-input"
                    className="cmd-input"
                    type="text"
                    value={form.note}
                    maxLength={MAX_NOTE}
                    onChange={(event) => setForm((f) => ({ ...f, note: event.target.value }))}
                    placeholder="Por ejemplo: cortada al medio"
                    enterKeyHint="done"
                    autoComplete="off"
                    data-testid="opt-note"
                  />
                  {form.note.length > MAX_NOTE - 40 ? (
                    <span className="cmd-count">
                      {form.note.length} de {MAX_NOTE}
                    </span>
                  ) : null}
                </div>
              ) : (
                <div className="cmd-opts">
                  <button
                    type="button"
                    className="cmd-opt"
                    onClick={() => setForm((f) => ({ ...f, noteOpen: true }))}
                    data-testid="opt-note-open"
                  >
                    <PencilLine aria-hidden />
                    Otra aclaración
                  </button>
                </div>
              )}
            </form>

            <div className="cmd-sheet-foot">
              <div className="cmd-qty-step">
                <button
                  type="button"
                  className="cmd-step"
                  onClick={() => setForm((f) => ({ ...f, quantity: Math.max(1, f.quantity - 1) }))}
                  disabled={form.quantity <= 1}
                  aria-label="Uno menos"
                >
                  <Minus aria-hidden />
                </button>
                <output className="cmd-bump" key={form.quantity} aria-label="Cantidad">
                  {form.quantity}
                </output>
                <button
                  type="button"
                  className="cmd-step"
                  onClick={() =>
                    setForm((f) => ({ ...f, quantity: Math.min(MAX_QUANTITY, f.quantity + 1) }))
                  }
                  disabled={form.quantity >= MAX_QUANTITY}
                  aria-label="Uno más"
                >
                  <Plus aria-hidden />
                </button>
              </div>
              <button
                type="button"
                className="pos-btn pos-btn-primary"
                onClick={confirm}
                disabled={adding && missing.length > 0}
                data-testid="opts-confirm"
              >
                {adding
                  ? missing[0]
                    ? `Falta: ${missing[0].name.toLowerCase()}`
                    : `Agregar · ${formatCentsShort(unit * form.quantity)}`
                  : 'Listo'}
              </button>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
