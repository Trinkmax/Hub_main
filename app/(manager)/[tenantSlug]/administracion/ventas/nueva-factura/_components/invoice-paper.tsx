import {
  PaperSheet,
  StatusPill,
  TicketRow,
  TicketRule,
  TicketTotal,
} from '@/components/administracion/kit'
import { formatIsoDay } from '@/lib/dates'
import { formatCuit } from '@/lib/fiscal'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * El papel de la «Factura aparte», que se llena solo al lado de los pasos: el
 * membrete con el recuadro de la letra, el número, la fecha, a quién, el
 * detalle y neto · IVA · total. Lo que todavía no se cargó va con «—» (nunca
 * «$ 0»: cero no es «todavía no lo puse»).
 *
 * Un sello dice qué papel es, nunca un estado: si ya se cobró o cuándo vence
 * va debajo del total, como `StatusPill`. Es `PaperSheet` (un documento), no
 * `Ticket` (lo que se cobra en el momento).
 */

export type InvoicePaperStatus = { tone: 'ok' | 'warn' | 'muted'; text: string }

export type InvoicePaperProps = {
  /** «Factura», «Nota de crédito», «Nota de débito». */
  title: string
  /** La letra del comprobante; `null` si todavía no se sabe. */
  letter: 'A' | 'B' | null
  /** «0003-00000088»; `null` si todavía no tiene número. */
  numberText: string | null
  /** Aclaración del número: «lo pone ARCA al emitir». */
  numberHint?: string | null
  issueDate: string | null
  customerName: string | null
  customerTaxId: string | null
  /** Lo que se factura (el detalle de ARCA, o la nota). */
  detail: string | null
  /** «Eventos», «Salón», «Delivery». */
  channelLabel: string
  netCents: number
  vatCents: number
  /** No gravado + exento. */
  otherCents: number
  totalCents: number
  status: InvoicePaperStatus | null
  className?: string
}

/** Neto e IVA del papel, a partir de lo que arma el formulario. */
export function paperAmounts(input: {
  aliquots: ReadonlyArray<{ netCents: number | null }>
  nonTaxedCents: number
  exemptCents: number
  totalCents: number
}): { netCents: number; vatCents: number; otherCents: number } {
  const netCents = input.aliquots.reduce((sum, a) => sum + (a.netCents ?? 0), 0)
  const otherCents = input.nonTaxedCents + input.exemptCents
  return { netCents, otherCents, vatCents: Math.max(0, input.totalCents - netCents - otherCents) }
}

function Field({
  label,
  value,
  sub,
  muted,
}: {
  label: string
  value: string
  /** Un segundo renglón (el CUIT, entero en su renglón). */
  sub?: string | null
  muted?: boolean
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className={cn('mt-0.5 text-sm text-pretty', muted && 'text-muted-foreground')}>{value}</p>
      {sub ? <p className="text-sm whitespace-nowrap tabular-nums">{sub}</p> : null}
    </div>
  )
}

export function InvoicePaper({
  title,
  letter,
  numberText,
  numberHint,
  issueDate,
  customerName,
  customerTaxId,
  detail,
  channelLabel,
  netCents,
  vatCents,
  otherCents,
  totalCents,
  status,
  className,
}: InvoicePaperProps) {
  const hasAmounts = totalCents > 0
  const money = (cents: number) => (hasAmounts ? formatCents(cents) : '—')
  return (
    <PaperSheet
      className={className}
      aria-label={`${title}${letter ? ` ${letter}` : ''}: así va quedando`}
      title={title}
      aside={
        <span className="font-mono tabular-nums">
          {numberText ? `N.º ${numberText}` : (numberHint ?? 'sin número todavía')}
        </span>
      }
    >
      <div className="flex items-start gap-4">
        {/* El recuadro de la letra, como en el encabezado de una factura de verdad. Sin cliente
            todavía no se sabe: va vacío y punteado. */}
        <div
          aria-hidden={letter === null}
          className={cn(
            'flex size-14 shrink-0 flex-col items-center justify-center rounded-[3px] border-2',
            letter === null ? 'border-dashed border-current/35' : 'border-current',
          )}
        >
          {letter ? (
            <span className="font-serif text-3xl font-semibold leading-none">{letter}</span>
          ) : null}
        </div>
        <div className="grid min-w-0 flex-1 gap-2.5">
          <Field
            label="Fecha"
            value={issueDate ? formatIsoDay(issueDate) : '—'}
            muted={!issueDate}
          />
          <Field
            label="Señor/es"
            value={customerName ?? 'Todavía sin elegir'}
            sub={customerName && customerTaxId ? `CUIT ${formatCuit(customerTaxId)}` : null}
            muted={!customerName}
          />
        </div>
      </div>

      <TicketRule />
      <Field label="Detalle" value={detail?.trim() || channelLabel} muted={!detail?.trim()} />

      <TicketRule />
      <TicketRow label="Neto" value={money(netCents)} muted={!hasAmounts} />
      <TicketRow label="IVA" value={money(vatCents)} muted={!hasAmounts} />
      {otherCents > 0 ? <TicketRow label="No gravado y exento" value={money(otherCents)} /> : null}
      <TicketRule double />
      <TicketTotal label="Total" value={money(totalCents)} />
      {status ? (
        <div className="mt-4 flex justify-end">
          <StatusPill tone={status.tone}>{status.text}</StatusPill>
        </div>
      ) : null}
    </PaperSheet>
  )
}
