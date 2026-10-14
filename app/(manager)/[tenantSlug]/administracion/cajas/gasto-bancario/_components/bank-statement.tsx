import type { ReactNode } from 'react'
import {
  Ticket,
  TicketHeader,
  TicketNote,
  TicketRow,
  TicketRule,
  TicketStamp,
  TicketTotal,
} from '@/components/administracion/kit'
import type { PaperStamp } from '@/components/administracion/voucher-stamp'
import { cn } from '@/lib/utils'

export type BankStatementRow = {
  key: string
  label: string
  /** Ya formateado. */
  value: string
  hint?: string
}

/**
 * El resumen del banco que se va armando mientras se cargan los gastos: los
 * renglones como figuran en el papel y el total que tiene que dar. Es lo que el
 * dueño controla de un vistazo contra el resumen que tiene en la mano (el
 * asiento queda plegado debajo, para la contadora).
 *
 * El sello dice qué papel respalda el gasto, con el MISMO texto que la ficha
 * del comprobante (`voucherStamp`): «Con resumen del banco», «Con factura A»,
 * «Con otro comprobante». Sin comprobante del banco NO hay sello: ese gasto se
 * guarda sin tipo de papel (no es «sin factura») y lo dice la letra chica.
 */
export function BankStatement({
  title,
  subtitle,
  rows,
  total,
  totalHint,
  stamp,
  notes,
  pending,
  className,
}: {
  /** El nombre de la cuenta, o «Resumen del banco» si todavía no se eligió. */
  title: string
  /** «Débitos · 13/10». */
  subtitle: string
  rows: readonly BankStatementRow[]
  /** Ya formateado, o «—» si todavía no hay importes. */
  total: string
  totalHint?: ReactNode
  stamp: PaperStamp | null
  /** La letra chica: cómo viene contra el total del resumen y qué pasa con el IVA. */
  notes: readonly string[]
  /** Todavía no hay nada cargado: el papel se ve en borrador. */
  pending: boolean
  className?: string
}) {
  return (
    <Ticket aria-label="El resumen del banco que vas cargando" className={className}>
      <TicketHeader title={title} subtitle={subtitle} className={cn(pending && 'opacity-70')}>
        {stamp ? <TicketStamp tone={stamp.tone}>{stamp.text}</TicketStamp> : null}
      </TicketHeader>
      <TicketRule />
      {rows.length > 0 ? (
        rows.map((row) => (
          <TicketRow key={row.key} label={row.label} value={row.value} hint={row.hint} />
        ))
      ) : (
        <TicketRow muted label="Todavía sin conceptos" value="—" />
      )}
      <TicketRule double />
      <TicketTotal label="Total debitado" value={total} hint={totalHint} />
      {notes.length > 0 ? (
        <TicketNote>
          {notes.map((note) => (
            <span key={note} className="block">
              {note}
            </span>
          ))}
        </TicketNote>
      ) : null}
    </Ticket>
  )
}
