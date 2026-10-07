'use client'

import { Users } from 'lucide-react'
import { useEffect, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { NumberField } from '@/components/ui/number-field'
import { bulkUpdateActualGuests } from '@/lib/salon/actions'
import type { SalonReservationStatus } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

/**
 * La celda de personas de la agenda, editable en el lugar.
 *
 * El dueño lo pidió así: "una forma más práctica". Antes corregir 20 → 18 desde
 * esta pantalla era abrir el popup de la reserva, encontrar el stepper y
 * esperar el debounce. Ahora es un toque por persona, sin salir de la fila.
 *
 * Guarda por `bulkUpdateActualGuests` con UNA entrada, no por
 * `updateActualGuests`: esa escribe el número pero deja la reserva en
 * `pending`, y entonces el registro se contradice solo — "vinieron 18" en una
 * mesa que figura como que nunca llegó. La action de lote transiciona a
 * `arrived` cuando hace falta, así que anotar la asistencia significa lo mismo
 * desde la agenda que desde el salón.
 *
 * Optimista con reversión: el número cambia YA y se guarda con debounce. Si
 * falla, vuelve al valor del server y avisa — nadie se queda creyendo que anotó
 * algo que no se guardó.
 */
export function AttendanceCell({
  tenantSlug,
  reservationId,
  status,
  estimatedGuests,
  actualGuests,
  canEdit,
  isPast,
}: {
  tenantSlug: string
  reservationId: string
  status: SalonReservationStatus
  estimatedGuests: number
  actualGuests: number | null
  canEdit: boolean
  /** ¿La reserva ya pasó (hoy o antes)? Ver `editable`. */
  isPast: boolean
}) {
  const [value, setValue] = useState(actualGuests ?? estimatedGuests)
  const [confirmed, setConfirmed] = useState(actualGuests !== null)
  const [pending, startTransition] = useTransition()
  const serverRef = useRef(actualGuests)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Re-sync cuando el server manda otro valor (por ejemplo después de "Pasar
  // lista", que revalida la página). Sin esto la fila seguiría mostrando 20
  // sobre un 18 recién guardado, y el próximo toque pisaría el valor bueno.
  useEffect(() => {
    if (debounceRef.current) return // hay una edición en vuelo: no la pisemos
    serverRef.current = actualGuests
    setValue(actualGuests ?? estimatedGuests)
    setConfirmed(actualGuests !== null)
  }, [actualGuests, estimatedGuests])

  // No se registra asistencia de:
  //  - canceladas / no vino: no hay nada que contar;
  //  - reservas a futuro: marcar que "vinieron 20" el martes que viene le
  //    liquidaría la comisión al gestor por una mesa que todavía no existió, y
  //    un toque accidental en la agenda del mes no tiene deshacer obvio.
  const editable = canEdit && isPast && status !== 'cancelled' && status !== 'no_show'

  function commit(next: number) {
    startTransition(async () => {
      const res = await bulkUpdateActualGuests(tenantSlug, {
        entries: [{ id: reservationId, actual_guests: next }],
      })
      if (res.ok) {
        serverRef.current = next
        setConfirmed(true)
      } else {
        setValue(serverRef.current ?? estimatedGuests)
        setConfirmed(serverRef.current !== null)
        toast.error(res.message ?? 'No pudimos guardar la cantidad.')
      }
    })
  }

  function bump(next: number) {
    setValue(next)
    setConfirmed(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
      commit(next)
    }, 700)
  }

  // Si la fila se desmonta con un cambio en debounce (cambio de página, de día,
  // un filtro), lo guardamos igual. Perder el conteo sin ningún aviso es el peor
  // final posible: el encargado cree que quedó anotado.
  const flushRef = useRef<() => void>(() => {})
  flushRef.current = () => {
    if (!debounceRef.current) return
    clearTimeout(debounceRef.current)
    debounceRef.current = null
    void bulkUpdateActualGuests(tenantSlug, {
      entries: [{ id: reservationId, actual_guests: value }],
    }).then((res) => {
      if (!res.ok) toast.error(res.message ?? 'No pudimos guardar la cantidad.')
    })
  }
  useEffect(() => () => flushRef.current(), [])

  if (!editable) {
    return (
      <span className="inline-flex items-center gap-1 tabular-nums">
        <Users className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="font-semibold">{actualGuests ?? estimatedGuests}</span>
        <span className="sr-only">
          {(actualGuests ?? estimatedGuests) === 1 ? 'persona' : 'personas'}
        </span>
      </span>
    )
  }

  const statusText = confirmed
    ? value === estimatedGuests
      ? 'vinieron'
      : `de ${estimatedGuests} reservadas`
    : 'sin contar'

  return (
    <span className="inline-flex flex-col items-start gap-1">
      {/* El NumberField del kit: − y + de un toque, se puede tipear (20 → 18
          sin tocar dos veces) y las flechas suman o restan. Sin contar, el
          número se ve apagado: es la reserva mostrada como punto de partida,
          no un conteo. Contado, se ve firme. */}
      <NumberField
        value={value}
        onValueChange={(next) => {
          if (next !== null && next !== value) bump(next)
        }}
        min={1}
        max={99}
        size="sm"
        aria-label={`Personas que vinieron (${statusText})`}
        incrementLabel="Una persona más"
        decrementLabel="Una persona menos"
        // Sin deshabilitar mientras guarda: con el foco adentro, un campo que se
        // apaga pierde el cursor. Next encola las Server Actions en orden.
        aria-busy={pending || undefined}
        className={cn('w-28', !confirmed && '[&_input]:text-muted-foreground')}
      />
      {/* Marcador discreto y no un chip de color: con 111 de 137 reservas sin
          contar, un chip ámbar por fila pintaría la agenda entera y dejaría de
          significar algo. El total que falta lo grita el botón "Pasar lista". */}
      <span className={cn('type-caption text-muted-foreground', !confirmed && 'italic')}>
        {statusText}
      </span>
    </span>
  )
}
