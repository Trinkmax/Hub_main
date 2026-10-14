import type { ReactNode } from 'react'
import {
  Ticket,
  TicketHeader,
  TicketNote,
  TicketRow,
  TicketRule,
} from '@/components/administracion/kit/ticket'

/**
 * «Tu columna del cierre»: los medios prendidos, numerados y en el orden plano
 * de Ajustes, sobre el mismo papel del ticket del cierre del día. Es el objeto
 * de la habitación «Medios de cobro»: lo que se arma acá es, ni más ni menos,
 * la columna que después se pega entera en el cierre.
 *
 * Los importes van punteados («$ ·····»): acá no hay plata, hay un orden. Se
 * redibuja sola al prender, apagar o reordenar un medio.
 *
 * Cuándo NO: para mostrar un cierre cargado (eso es `CloseTicket`).
 */
export function CloseColumnTicket({
  names,
  note = 'Es el orden de tu cierre de caja: en el cierre del día pegás la columna entera.',
  footer,
  className,
}: {
  /** Los medios prendidos, en orden. */
  names: readonly string[]
  note?: ReactNode
  /** Debajo de la nota, dentro del papel. */
  footer?: ReactNode
  className?: string
}) {
  return (
    <Ticket aria-label="Tu columna del cierre" className={className}>
      <TicketHeader title="Tu columna del cierre" subtitle="En este orden" />
      <div className="mt-4">
        <TicketRule />
      </div>
      {names.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground text-pretty">
          Prendé un medio y acá aparece su renglón.
        </p>
      ) : (
        <ol className="py-1.5">
          {names.map((name, index) => (
            // El número ES la posición: si el orden cambia, cambia el renglón.
            // biome-ignore lint/suspicious/noArrayIndexKey: el renglón es su posición en la columna
            <li key={`${index}-${name}`}>
              <TicketRow
                muted
                label={
                  <>
                    <span className="font-mono text-foreground tabular-nums">{index + 1}</span>
                    <span aria-hidden> · </span>
                    <span className="text-foreground">{name}</span>
                  </>
                }
                value={<span aria-hidden>$ ·····</span>}
              />
            </li>
          ))}
        </ol>
      )}
      <TicketRule />
      <TicketNote>{note}</TicketNote>
      {footer}
    </Ticket>
  )
}
