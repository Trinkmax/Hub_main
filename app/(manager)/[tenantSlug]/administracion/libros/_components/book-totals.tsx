import { CircleAlert, CircleCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * Los totales de un libro en UNA banda: pares «ETIQUETA / valor», cada uno con
 * su raya a la izquierda. Reemplaza a las cuatro tarjetas iguales de los Libros
 * IVA: en un libro los totales son un renglón de control, no un tablero.
 *
 * Cada par baja ENTERO de renglón si no entra: un importe nunca se parte.
 * `seal` es el control del libro («Debe = Haber») y `note` una aclaración al
 * pie. Server-safe.
 */

export type BookTotalItem = {
  key: string
  label: string
  /** Ya armado: un `Amount`, un número, un esqueleto. */
  value: ReactNode
  /** Una aclaración chica debajo del valor («computable $ 1.234,00»). */
  hint?: ReactNode
}

export function BookTotals({
  items,
  seal,
  note,
  label = 'Totales del período',
  className,
}: {
  items: readonly BookTotalItem[]
  seal?: ReactNode
  note?: ReactNode
  /** Para lectores de pantalla. */
  label?: string
  className?: string
}) {
  if (items.length === 0 && !seal) return null
  return (
    <section
      aria-label={label}
      className={cn('card-hairline rounded-2xl border bg-card px-4 py-3 shadow-xs', className)}
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <dl className="flex min-w-0 flex-wrap gap-x-6 gap-y-3">
          {items.map((item) => (
            <div key={item.key} className="min-w-0 border-l-2 border-border/70 pl-3">
              <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {item.label}
              </dt>
              <dd className="mt-0.5 whitespace-nowrap text-sm font-semibold">{item.value}</dd>
              {item.hint ? (
                <dd className="whitespace-nowrap text-xs text-muted-foreground">{item.hint}</dd>
              ) : null}
            </div>
          ))}
        </dl>
        {seal ? <div className="shrink-0 sm:ml-auto">{seal}</div> : null}
      </div>
      {note ? <p className="mt-2 text-xs text-muted-foreground text-pretty">{note}</p> : null}
    </section>
  )
}

/** «Debe = Haber» (o el aviso, que no debería verse nunca). El control de un libro por partida doble. */
export function BalanceSeal({
  balanced,
  unbalancedText = 'No cuadra: avisanos',
}: {
  balanced: boolean
  /** «No cuadra por $ 12,40: avisanos». */
  unbalancedText?: string
}) {
  return balanced ? (
    <StatusPill tone="ok" icon={CircleCheck}>
      Debe = Haber
    </StatusPill>
  ) : (
    <StatusPill tone="late" icon={CircleAlert}>
      {unbalancedText}
    </StatusPill>
  )
}

/** El valor de un total que todavía se está leyendo: una raya del ancho de un importe. */
export function TotalPending() {
  return <Skeleton className="inline-block h-4 w-28 align-middle" />
}
