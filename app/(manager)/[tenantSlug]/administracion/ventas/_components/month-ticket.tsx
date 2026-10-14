import {
  Ticket,
  TicketHeader,
  TicketNote,
  TicketRow,
  TicketRule,
  TicketStamp,
  TicketTotal,
} from '@/components/administracion/kit'
import { formatCents } from '@/lib/money'
import { invoicedStamp, type MonthTicketData } from '../_lib/invoiced-view'

/**
 * El ticket del mes: lo vendido por canal, el total y cuánto fue con factura
 * y cuánto sin. Lleva el MISMO sello que el ticket de cada noche («76 % con
 * factura», «Sin factura», «Todo con factura») y la misma frase al pie: es el
 * mismo papel, mirado de lejos. Ningún sello es una alarma.
 *
 * Cuándo NO: para una sola noche (eso es `CloseTicket`) ni para el cierre del
 * mes de la contadora (la carátula de Libros).
 */
export function MonthTicket({
  data,
  subtitle,
  className,
}: {
  data: MonthTicketData
  /** El período: «Octubre 2026». */
  subtitle: string
  className?: string
}) {
  const stamp = invoicedStamp(data.split)
  // Como un tique de verdad: si algún importe tiene centavos, los llevan todos.
  const withCents = [
    data.soldCents,
    data.invoicedCents,
    data.uninvoicedCents,
    ...data.channels.flatMap((c) => [c.soldCents, c.invoicedCents, c.uninvoicedCents]),
  ].some((cents) => cents % 100 !== 0)
  const money = (cents: number) => formatCents(cents, { decimals: withCents ? 2 : 0 })

  return (
    <Ticket className={className} aria-label={`Ticket de lo vendido, ${subtitle}`}>
      <TicketHeader title="Lo vendido" subtitle={subtitle}>
        {stamp ? <TicketStamp tone={stamp.tone}>{stamp.text}</TicketStamp> : null}
      </TicketHeader>
      <TicketRule />
      {data.channels.map((channel) => (
        <TicketRow
          key={channel.channel}
          label={channel.label}
          value={money(channel.soldCents)}
          hint={
            channel.uninvoicedCents === 0 ? (
              'todo con factura'
            ) : channel.invoicedCents === 0 ? (
              'todo sin factura'
            ) : (
              <>
                <span className="block">con factura {money(channel.invoicedCents)}</span>
                <span className="block">sin factura {money(channel.uninvoicedCents)}</span>
              </>
            )
          }
        />
      ))}
      <TicketRule double />
      <TicketTotal label="Total vendido" value={money(data.soldCents)} hint="antes de comisiones" />
      <TicketRule />
      <TicketRow
        label="Con factura"
        muted={data.invoicedCents === 0}
        value={money(data.invoicedCents)}
      />
      <TicketRow
        label="Sin factura"
        muted={data.uninvoicedCents === 0}
        value={money(data.uninvoicedCents)}
      />
      <TicketNote>Con factura o sin factura, todo queda registrado en los libros.</TicketNote>
    </Ticket>
  )
}
