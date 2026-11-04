'use client'

import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useHaptic } from '@/app/(manager)/[tenantSlug]/operativo/_components/use-haptic'
import { admitLanded, type DoorTicket, doorVerdict } from '@/lib/ticketing/door'
import { admitDoorTicket, lookupDoorTicket, undoDoorTicket } from '@/lib/ticketing/door-actions'
import {
  DOOR_RETURN_MS,
  DoorProblemView,
  type DoorStage,
  DoorVerdictView,
} from './door-verdict-view'
import './door.css'

// Lo que tarda el talón en caer (.door-half-stub[data-falling]).
const TEAR_MS = 1150
// Con mala señal una acción puede quedar colgada: la pantalla no la espera más que esto.
const WAIT_MS = 10_000

const NO_SIGNAL = 'No pudimos consultar la entrada. Revisá la señal y probá de nuevo.'

function withDeadline<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('door_timeout')), WAIT_MS)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

type Problem = { word: string; note: string; retry: string; canReload?: boolean }

/**
 * Una entrada escaneada: la busca, muestra el veredicto y deja pasar con un toque.
 * Lo comparten la pestaña Puerta y el escáner del salón.
 *
 * Escanear no marca nada: es para que quien recibe vea el nombre, cuántos son y
 * cuánto falta cobrar antes de tocar (decisión del 03/11/2026).
 */
export function TicketDoorPanel({
  tenantSlug,
  token,
  onDone,
}: {
  tenantSlug: string
  token: string
  onDone: () => void
}) {
  const haptic = useHaptic()
  const [ticket, setTicket] = useState<DoorTicket | null>(null)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [stage, setStage] = useState<DoorStage>('verdict')
  const [guests, setGuests] = useState(1)
  const [admitError, setAdmitError] = useState<string | null>(null)
  const [undoNote, setUndoNote] = useState<string | null>(null)
  // Se deshace una sola vez por entrada: el botón no vuelve a aparecer.
  const [undone, setUndone] = useState(false)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  const show = useCallback(
    (next: DoorTicket) => {
      setTicket(next)
      const verdict = doorVerdict(next)
      if (verdict.kind === 'admit') {
        setGuests(verdict.left)
        haptic(18)
      } else {
        haptic([70, 50, 70])
      }
    },
    [haptic],
  )

  useEffect(() => {
    let cancelled = false
    setTicket(null)
    setProblem(null)
    setStage('verdict')
    setAdmitError(null)
    setUndoNote(null)
    setUndone(false)
    withDeadline(lookupDoorTicket(tenantSlug, token)).then(
      (result) => {
        if (cancelled) return
        if (result.ok) {
          show(result.ticket)
        } else if (result.reason === 'not_found') {
          haptic([70, 50, 70])
          setProblem({
            word: 'No figura',
            note: 'Este código no es de una entrada de este bar. Pedile a la persona que abra su entrada de nuevo, o buscala por nombre en Reservas.',
            retry: 'Escanear otra',
          })
        } else {
          haptic([70, 50, 70])
          setProblem({ word: 'No se pudo', note: result.message, retry: 'Volver a la cámara' })
        }
      },
      // Sin señal, tiempo agotado, o una versión nueva de la app desde que se abrió
      // esta pantalla (por eso se ofrece recargar).
      () => {
        if (cancelled) return
        haptic([70, 50, 70])
        setProblem({
          word: 'No se pudo',
          note: NO_SIGNAL,
          retry: 'Volver a la cámara',
          canReload: true,
        })
      },
    )
    return () => {
      cancelled = true
    }
  }, [tenantSlug, token, show, haptic])

  const admit = useCallback(async () => {
    if (!ticket) return
    const verdict = doorVerdict(ticket)
    const insideBefore = verdict.kind === 'admit' ? verdict.inside : 0
    setStage('admitting')
    setAdmitError(null)
    try {
      const result = await withDeadline(
        admitDoorTicket(tenantSlug, ticket.order_id, guests, insideBefore),
      )
      if (!result.ok) {
        setStage('verdict')
        setAdmitError(
          result.reason === 'error'
            ? result.message
            : 'No encontramos esta entrada. Probá de nuevo.',
        )
        return
      }
      setTicket(result.ticket)
      if (result.admitted) {
        haptic(30)
        setStage('falling')
        return
      }
      // La base no dejó (otro celular la validó recién): se muestra cómo está ahora.
      setStage('verdict')
      show(result.ticket)
    } catch {
      // Se perdió la respuesta: pudo haber entrado igual. Se mira antes de ofrecer
      // reintentar (y reintentar no cuenta dos veces: la base compara cuántos había).
      try {
        const fresh = await withDeadline(lookupDoorTicket(tenantSlug, ticket.short_code))
        if (fresh.ok && admitLanded(insideBefore, guests, fresh.ticket)) {
          setTicket(fresh.ticket)
          haptic(30)
          setStage('falling')
          return
        }
      } catch {
        // Sigue sin señal: se avisa abajo.
      }
      setStage('verdict')
      setAdmitError('No pudimos confirmar si entraron. Revisá la señal y probá de nuevo.')
    }
  }, [ticket, tenantSlug, guests, haptic, show])

  const undo = useCallback(async () => {
    if (!ticket) return
    setStage('undoing')
    setUndoNote(null)
    try {
      const result = await withDeadline(undoDoorTicket(tenantSlug, ticket.order_id))
      if (result.ok) {
        setUndone(true)
        setStage('verdict')
        show(result.ticket)
        return
      }
      setUndone(true)
      setUndoNote(
        result.reason === 'error'
          ? result.message
          : 'No pudimos deshacerlo. Corregilo en Reservas.',
      )
    } catch {
      setUndoNote('No pudimos deshacerlo. Revisá la señal o corregilo en Reservas.')
    }
    setStage('done')
  }, [ticket, tenantSlug, show])

  useEffect(() => {
    if (stage === 'falling') {
      const timer = setTimeout(() => setStage('done'), TEAR_MS)
      return () => clearTimeout(timer)
    }
    // Si no se pudo deshacer, se queda el aviso a la vista hasta que toquen.
    if (stage === 'done' && !undoNote) {
      const timer = setTimeout(() => onDoneRef.current(), DOOR_RETURN_MS)
      return () => clearTimeout(timer)
    }
  }, [stage, undoNote])

  if (problem) {
    return (
      <DoorProblemView
        word={problem.word}
        note={problem.note}
        retryLabel={problem.retry}
        onNext={onDone}
        onReload={problem.canReload ? () => window.location.reload() : undefined}
      />
    )
  }
  if (!ticket) {
    return (
      <div
        className="door door-scan -mx-4 -mt-3 flex items-center justify-center"
        aria-live="polite"
      >
        <div className="flex flex-col items-center gap-3 px-4 text-center">
          <Loader2 className="size-8 animate-spin" aria-hidden />
          <p className="text-base">Buscando la entrada…</p>
          <button type="button" className="door-btn door-btn-soft mt-2 px-5" onClick={onDone}>
            Volver a la cámara
          </button>
        </div>
      </div>
    )
  }
  return (
    <DoorVerdictView
      ticket={ticket}
      verdict={doorVerdict(ticket)}
      stage={stage}
      guests={guests}
      onGuests={setGuests}
      onAdmit={admit}
      onNext={onDone}
      onUndo={undone ? undefined : undo}
      undoNote={undoNote}
      errorMessage={admitError}
    />
  )
}
