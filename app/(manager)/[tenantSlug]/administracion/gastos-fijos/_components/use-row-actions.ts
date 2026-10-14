'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { toastUndo } from '@/components/administracion/quick-actions'
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import {
  deleteRecurringExpense,
  saveRecurringExpense,
  skipRecurringDue,
} from '@/lib/accounting/actions/master'
import type { RecurringExpenseRow } from '@/lib/accounting/queries/documents'
import { formatCentsShort } from '@/lib/money'
import {
  type EditableRow,
  quickEditPatch,
  type RowEditPatch,
  recurringEditPayload,
  type SaveFailure,
  saveFailure,
} from '../_lib/planilla-words'
import type { SaveState } from './save-mark'

/**
 * Lo que la planilla de gastos fijos escribe sin pasar por la ficha. Todo usa
 * acciones que ya existían, con el envío de siempre:
 *
 * - `skipRecurringDue` («Este mes no se paga») con su «Deshacer» de 6 s;
 * - `deleteRecurringExpense` («Eliminar»);
 * - `saveRecurringExpense` con el paquete de una edición del renglón
 *   (`recurringEditPayload`: las 15 claves del «Deshacer» de antes) para todo lo
 *   demás: «Sí se paga este mes», pausar y reanudar, «Volver a dejarlo
 *   pendiente», dejar como monto lo que se pagó y cambiar monto y día.
 *
 * Después de cada una el servidor revalida la sección y la pantalla se
 * actualiza sola; el `refresh` es por si la respuesta no trajo la página.
 */

const STALE_TEXT = 'Alguien cambió este gasto fijo recién. Recargá la página y probá de nuevo.'

type EditResult = { ok: true; saved: EditableRow } | { ok: false; failure: SaveFailure }

/** Una edición del renglón: arma el paquete y llama a la acción de siempre. */
async function saveRowEdit(
  tenantSlug: string,
  row: EditableRow,
  patch: RowEditPatch,
): Promise<EditResult> {
  try {
    const result = await saveRecurringExpense(tenantSlug, recurringEditPayload(row, patch))
    if (!result.ok) return { ok: false, failure: saveFailure(result) }
    return { ok: true, saved: { ...result.data, breakdown: result.data.breakdown } }
  } catch {
    return { ok: false, failure: { kind: 'other', message: ACC_UNREACHABLE.offline } }
  }
}

// ─── Los gestos del renglón ──────────────────────────────────────────────────

export function useRowActions(tenantSlug: string) {
  const router = useRouter()
  const [busy, start] = useTransition()

  const fail = useCallback(
    (failure: SaveFailure) => {
      toast.error(failure.kind === 'stale' ? STALE_TEXT : failure.message)
      if (failure.kind === 'stale') router.refresh()
    },
    [router],
  )

  /** Una edición con su aviso. `undo` deja «Deshacer» 6 s con la edición inversa. */
  const edit = useCallback(
    (
      row: EditableRow,
      patch: RowEditPatch,
      done: { message: string; undo?: { patch: RowEditPatch; message: string } },
    ) =>
      start(async () => {
        const result = await saveRowEdit(tenantSlug, row, patch)
        if (!result.ok) return fail(result.failure)
        router.refresh()
        const undo = done.undo
        if (!undo) {
          toast.success(done.message)
          return
        }
        toastUndo(done.message, {
          onUndo: async () => {
            const undone = await saveRowEdit(tenantSlug, result.saved, undo.patch)
            if (!undone.ok) return fail(undone.failure)
            toast.success(undo.message)
            router.refresh()
          },
        })
      }),
    [tenantSlug, router, fail],
  )

  /** «Este mes no se paga»: no pregunta, avanza al próximo y deja «Deshacer». */
  const skip = useCallback(
    (row: Pick<RecurringExpenseRow, 'id' | 'name' | 'nextDueDate'>) =>
      start(async () => {
        try {
          const result = await skipRecurringDue(tenantSlug, {
            id: row.id,
            dueDate: row.nextDueDate,
          })
          // Los avisos de error de este gesto son los de siempre: lo que dice el servidor.
          if (!result.ok) {
            toast.error(result.message)
            if (result.code === 'stale') router.refresh()
            return
          }
          const saved = result.data
          router.refresh()
          toastUndo(`«${row.name}»: este mes no se paga`, {
            description: result.message,
            onUndo: async () => {
              try {
                // Vuelve a poner el vencimiento que había; si era la última cuota,
                // no pagarla lo apagó y deshacer lo vuelve a prender.
                const undone = await saveRecurringExpense(
                  tenantSlug,
                  recurringEditPayload(saved, { nextDueDate: row.nextDueDate, active: true }),
                )
                if (undone.ok) {
                  toast.success('Listo: volvió a quedar pendiente.')
                  router.refresh()
                } else {
                  toast.error(undone.message)
                }
              } catch {
                toast.error(ACC_UNREACHABLE.offline)
              }
            },
          })
        } catch {
          toast.error(ACC_UNREACHABLE.offline)
        }
      }),
    [tenantSlug, router],
  )

  /** «Sí se paga este mes»: vuelve al vencimiento que se había salteado. */
  const unskip = useCallback(
    (row: RecurringExpenseRow) => {
      if (!row.skippedDue) return
      edit(
        row,
        { nextDueDate: row.skippedDue, active: true },
        { message: 'Listo: volvió a quedar pendiente.' },
      )
    },
    [edit],
  )

  const pause = useCallback(
    (row: RecurringExpenseRow) =>
      edit(
        row,
        { active: false },
        {
          message: `«${row.name}» quedó en pausa`,
          undo: { patch: { active: true }, message: 'Listo: volvió a la planilla.' },
        },
      ),
    [edit],
  )

  const resume = useCallback(
    (row: RecurringExpenseRow) =>
      edit(row, { active: true }, { message: `«${row.name}» volvió a la planilla.` }),
    [edit],
  )

  /** «Volver a dejarlo pendiente»: el vencimiento que cubría el pago anulado. */
  const restore = useCallback(
    (row: RecurringExpenseRow) => {
      if (!row.loadedDue) return
      edit(
        row,
        { nextDueDate: row.loadedDue, active: true },
        { message: 'Listo: volvió a quedar pendiente.' },
      )
    },
    [edit],
  )

  /** «Sí, dejar $ X» / «Usar $ X de ahora en más»: lo pagado pasa a ser el monto de siempre. */
  const keepAmount = useCallback(
    (row: RecurringExpenseRow, cents: number) =>
      edit(
        row,
        { amountCents: cents },
        { message: `Listo: «${row.name}» queda en ${formatCentsShort(cents)}.` },
      ),
    [edit],
  )

  const remove = useCallback(
    (row: Pick<RecurringExpenseRow, 'id' | 'updatedAt'>, done?: () => void) =>
      start(async () => {
        try {
          const result = await deleteRecurringExpense(tenantSlug, {
            id: row.id,
            expectedUpdatedAt: row.updatedAt,
          })
          done?.()
          if (!result.ok) {
            toast.error(result.code === 'stale' ? STALE_TEXT : result.message)
            if (result.code === 'stale') router.refresh()
            return
          }
          toast.success(result.message)
          router.refresh()
        } catch {
          toast.error(ACC_UNREACHABLE.offline)
        }
      }),
    [tenantSlug, router],
  )

  return { busy, skip, unskip, pause, resume, restore, keepAmount, remove }
}

// ─── Monto y día, en el lugar ────────────────────────────────────────────────

export type RowEditMark = { state: SaveState; failure: SaveFailure | null }

const IDLE: RowEditMark = { state: 'idle', failure: null }

/**
 * El monto y el día de un renglón, que se guardan solos: lo usan el renglón
 * abierto de la planilla y cada renglón de «Completar».
 *
 * - Un solo guardado en vuelo por renglón. Lo que se escriba mientras tanto
 *   espera su turno y sale con el `updatedAt` que devolvió el anterior.
 * - Si nada cambió, no se llama.
 * - Cuando la pantalla se refresca, toma siempre el `updatedAt` nuevo y, solo
 *   si no hay nada escrito sin guardar, los valores.
 */
export function useRowEdit(tenantSlug: string, row: RecurringExpenseRow) {
  const [base, setBase] = useState<EditableRow & Pick<RecurringExpenseRow, 'breakdown'>>(row)
  const [amountCents, setAmountCents] = useState<number | null>(row.amountCents)
  const [dueDay, setDueDay] = useState<number | null>(row.dueDay)
  const [mark, setMark] = useState<RowEditMark>(IDLE)
  const [pending, setPending] = useState(0)
  /** Lo completó «Pegar los montos» y todavía no se guardó. */
  const [pasted, setPasted] = useState(false)

  const baseRef = useRef(base)
  const draftRef = useRef({ amountCents, dueDay })
  const pendingRef = useRef(0)
  const queue = useRef<Promise<boolean>>(Promise.resolve(true))
  draftRef.current = { amountCents, dueDay }

  const adopt = useCallback((next: EditableRow & Pick<RecurringExpenseRow, 'breakdown'>) => {
    baseRef.current = next
    setBase(next)
  }, [])

  // La pantalla se refrescó: el `updatedAt` nuevo siempre; los valores, solo si no
  // hay nada a medio escribir ni un guardado esperando.
  // biome-ignore lint/correctness/useExhaustiveDependencies: solo cuando la fila cambia de versión
  useEffect(() => {
    if (pendingRef.current > 0) return
    const before = baseRef.current
    const untouched =
      draftRef.current.amountCents === before.amountCents &&
      draftRef.current.dueDay === before.dueDay
    adopt(row)
    if (untouched) {
      setAmountCents(row.amountCents)
      setDueDay(row.dueDay)
    }
  }, [row.updatedAt])

  const run = useCallback(
    (build: () => RowEditPatch | null): Promise<boolean> => {
      pendingRef.current += 1
      setPending(pendingRef.current)
      const task = queue.current.then(async () => {
        try {
          const patch = build()
          if (patch === null) return true
          setMark({ state: 'saving', failure: null })
          const result = await saveRowEdit(tenantSlug, baseRef.current, patch)
          if (!result.ok) {
            setMark({ state: 'error', failure: result.failure })
            return false
          }
          adopt({ ...result.saved, breakdown: result.saved.breakdown ?? [] })
          setPasted(false)
          setMark({ state: 'saved', failure: null })
          return true
        } finally {
          pendingRef.current -= 1
          setPending(pendingRef.current)
        }
      })
      queue.current = task.catch(() => false)
      return task
    },
    [tenantSlug, adopt],
  )

  /** Guarda lo que haya cambiado de monto y día (lo que esté escrito cuando le toque). */
  const commit = useCallback(
    () => run(() => quickEditPatch(baseRef.current, draftRef.current)),
    [run],
  )

  /** Otra edición del mismo renglón (la categoría, las cuotas), en la misma cola. */
  const save = useCallback((patch: RowEditPatch) => run(() => patch), [run])

  /** Vuelve a lo último guardado. */
  const revert = useCallback(() => {
    setAmountCents(baseRef.current.amountCents)
    setDueDay(baseRef.current.dueDay)
    setPasted(false)
    setMark(IDLE)
  }, [])

  /** Completa los campos con lo pegado, sin guardar. */
  const fill = useCallback((next: { amountCents: number; day: number | null }) => {
    setAmountCents(next.amountCents)
    if (next.day !== null) setDueDay(next.day)
    setPasted(true)
    setMark(IDLE)
  }, [])

  return {
    base,
    amountCents,
    dueDay,
    setAmountCents,
    setDueDay,
    mark,
    saving: pending > 0,
    pasted,
    dirty: quickEditPatch(base, { amountCents, dueDay }) !== null,
    commit,
    save,
    revert,
    fill,
  }
}
