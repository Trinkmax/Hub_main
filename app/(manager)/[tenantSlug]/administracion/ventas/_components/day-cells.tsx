'use client'

import { Pencil } from 'lucide-react'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { MoneyInput } from '@/components/administracion/money-input'
import { Input } from '@/components/ui/input'
import { saveSalesTargets } from '@/lib/accounting/actions/projection'
import { TARGET_NOTE_MAX } from '@/lib/accounting/projection-schemas'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { useMasterAction } from '../../ajustes/_components/use-master-action'

/**
 * Las dos celdas de la proyección que se editan en el lugar (solo quien
 * carga): el objetivo del día y su nota. Un toque abre el campo; Enter o salir
 * del campo guarda, Escape cancela. Lo guardado se ve enseguida y la tabla se
 * recalcula sola (acumulados y cumplimiento).
 */

const CELL_BUTTON =
  'inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-md px-2 text-sm outline-none transition-colors hover:bg-cream-tint focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 md:min-h-8'

/** Abrir y cerrar una celda: al cerrar con el teclado, el foco vuelve al botón. */
function useCell() {
  const [editing, setEditing] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const refocus = useRef(false)
  // Enter desmonta el campo y algunos navegadores disparan después su `blur`: ese no cuenta.
  const closed = useRef(true)

  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false
      buttonRef.current?.focus()
    }
  }, [editing])

  return {
    editing,
    buttonRef,
    open: () => {
      closed.current = false
      setEditing(true)
    },
    /** `false` si ya se había cerrado (el `blur` que llega después de Enter o Escape). */
    close: (keyboard: boolean): boolean => {
      if (closed.current) return false
      closed.current = true
      refocus.current = keyboard
      setEditing(false)
      return true
    },
  }
}

export function TargetCell({
  day,
  dayLabel,
  targetCents,
  align = 'end',
}: {
  day: string
  /** «lunes 12/10», para lectores de pantalla. */
  dayLabel: string
  targetCents: number | null
  align?: 'start' | 'end'
}) {
  const { tenantSlug } = useAccounting()
  const { pending, run } = useMasterAction()
  const cell = useCell()
  const [draft, setDraft] = useState<number | null>(targetCents)
  const [readable, setReadable] = useState(true)
  // Lo recién guardado se muestra hasta que la página trae el dato nuevo.
  const [saved, setSaved] = useState<{ from: number | null; value: number | null } | null>(null)
  const shown = saved && saved.from === targetCents ? saved.value : targetCents

  const commit = (keyboard: boolean) => {
    // Con un importe que no se entiende no se guarda: salir del campo descarta, Enter espera.
    if (!readable && keyboard) return
    if (!cell.close(keyboard) || !readable) return
    const next = draft === 0 ? null : draft
    if (next === shown) return
    setSaved({ from: targetCents, value: next })
    run(() => saveSalesTargets(tenantSlug, { items: [{ day, targetCents: next }] }), {
      quiet: true,
      onFailure: (state) => {
        setSaved(null)
        toast.error(state.message)
      },
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit(true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cell.close(true)
    }
  }

  if (cell.editing) {
    return (
      <MoneyInput
        value={draft}
        onValueChange={(cents, info) => {
          setDraft(cents)
          setReadable(info.parse.ok || info.parse.reason === 'vacio')
        }}
        size="sm"
        align="end"
        decimals="auto"
        autoFocus
        aria-label={`Objetivo del ${dayLabel}`}
        onKeyDown={onKeyDown}
        onBlur={() => commit(false)}
        className={cn('w-32', align === 'end' && 'ml-auto')}
      />
    )
  }

  return (
    <button
      ref={cell.buttonRef}
      type="button"
      disabled={pending}
      onClick={() => {
        setDraft(shown)
        setReadable(true)
        cell.open()
      }}
      aria-label={
        shown === null
          ? `Cargar el objetivo del ${dayLabel}`
          : `Objetivo del ${dayLabel}: ${formatCentsShort(shown)}. Cambiar`
      }
      className={cn(CELL_BUTTON, 'tabular-nums', align === 'end' ? '-mr-2' : '-ml-2')}
    >
      {shown === null ? (
        <span className="text-xs font-medium text-muted-foreground">Cargar</span>
      ) : (
        <span className="whitespace-nowrap">{formatCentsShort(shown)}</span>
      )}
      <Pencil className="size-3 shrink-0 text-muted-foreground/60" aria-hidden />
    </button>
  )
}

export function NoteCell({
  day,
  dayLabel,
  note,
}: {
  day: string
  dayLabel: string
  note: string | null
}) {
  const { tenantSlug } = useAccounting()
  const { pending, run } = useMasterAction()
  const cell = useCell()
  const [draft, setDraft] = useState(note ?? '')
  const [saved, setSaved] = useState<{ from: string | null; value: string | null } | null>(null)
  const shown = saved && saved.from === note ? saved.value : note

  const commit = (keyboard: boolean) => {
    if (!cell.close(keyboard)) return
    const next = draft.replace(/\s+/g, ' ').trim() || null
    if (next === shown) return
    setSaved({ from: note, value: next })
    run(() => saveSalesTargets(tenantSlug, { items: [{ day, note: next }] }), {
      quiet: true,
      onFailure: (state) => {
        setSaved(null)
        toast.error(state.message)
      },
    })
  }

  if (cell.editing) {
    return (
      <Input
        value={draft}
        maxLength={TARGET_NOTE_MAX}
        autoFocus
        placeholder="2x1 burger, Día de la madre…"
        aria-label={`Nota del ${dayLabel}`}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit(true)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            cell.close(true)
          }
        }}
        onBlur={() => commit(false)}
        className="h-11 min-w-40 text-base md:h-8 md:text-sm"
      />
    )
  }

  return (
    <button
      ref={cell.buttonRef}
      type="button"
      disabled={pending}
      onClick={() => {
        setDraft(shown ?? '')
        cell.open()
      }}
      aria-label={
        shown === null
          ? `Agregar una nota al ${dayLabel}`
          : `Nota del ${dayLabel}: ${shown}. Cambiar`
      }
      className={cn(CELL_BUTTON, '-ml-2 text-left')}
    >
      {shown === null ? (
        <span className="text-xs font-medium text-muted-foreground">Agregar nota</span>
      ) : (
        <span className="text-pretty">{shown}</span>
      )}
      <Pencil className="size-3 shrink-0 text-muted-foreground/60" aria-hidden />
    </button>
  )
}
