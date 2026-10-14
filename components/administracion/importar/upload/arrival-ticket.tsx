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
import { formatDayMonth, formatRange } from '@/lib/dates'
import { formatCount } from '@/lib/imports/ui/progress'
import type { UploadPlan } from '@/lib/imports/ui/upload'
import { formatCents } from '@/lib/money'

/**
 * «Llegó esto»: el papel que acusa recibo de un archivo recién leído, ANTES de
 * subirlo. Para las compras de ARCA, cuántos comprobantes, de cuántos
 * proveedores (con los tres más grandes: reconocer los nombres es lo que da
 * confianza) y el total. Para Mercado Pago y el banco, la cuenta a la vista:
 * saldo al empezar + entró − salió = saldo al terminar.
 *
 * Reemplaza a la grilla de rótulo/valor «Encontramos…». Los números salen de
 * `plan.figures`; si un archivo no trae saldos, esos renglones no se dibujan
 * (nunca un `$ 0` inventado). Nada de esto viaja al servidor. Server-safe.
 */
export function ArrivalTicket({
  plan,
  beforeStart,
  booksStartDate,
  className,
}: {
  plan: UploadPlan
  /** Renglones con fecha anterior al arranque del bar (no se van a poder cargar). */
  beforeStart: number
  booksStartDate: string | null
  className?: string
}) {
  const f = plan.figures
  const period =
    plan.periodFrom && plan.periodTo ? formatRange(plan.periodFrom, plan.periodTo) : null
  const notes: ReactNode[] = []
  let body: ReactNode

  if (!f) {
    // Un plan sin números (no debería pasar): lo que el lector dejó escrito.
    body = plan.facts.map((fact) => (
      <TicketRow key={fact.label} label={fact.label} value={fact.value} />
    ))
  } else if (plan.source === 'arca_recibidos') {
    const notesOfCredit = f.creditNotes ?? 0
    body = (
      <>
        {period ? <TicketRow label="Período" value={period} /> : null}
        <TicketRow
          label="Comprobantes"
          value={formatCount(f.items)}
          hint={
            notesOfCredit > 0
              ? notesOfCredit === 1
                ? '1 es nota de crédito'
                : `${notesOfCredit} son notas de crédito`
              : undefined
          }
        />
        {f.suppliers !== undefined ? (
          <TicketRow
            label="Proveedores"
            value={formatCount(f.suppliers)}
            hint={
              f.topSuppliers && f.topSuppliers.length > 0
                ? `${f.topSuppliers.length === 1 ? 'El más grande' : 'Los más grandes'}: ${joinNames(f.topSuppliers)}`
                : undefined
            }
          />
        ) : null}
        {f.totalCents !== undefined ? (
          <>
            <TicketRule />
            <TicketTotal label="Total" value={formatCents(f.totalCents)} />
          </>
        ) : null}
      </>
    )
    if ((f.foreignCurrency ?? 0) > 0) {
      notes.push(
        f.foreignCurrency === 1
          ? '1 está en otra moneda: te la muestro para confirmar el cambio.'
          : `${f.foreignCurrency} están en otra moneda: te las muestro para confirmar el cambio.`,
      )
    }
    if ((f.otherCuit ?? 0) > 0) {
      notes.push(
        f.otherCuit === 1
          ? '1 está a nombre de otra persona: te voy a preguntar si es tuya.'
          : `${f.otherCuit} están a nombre de otra persona: te voy a preguntar si son tuyas.`,
      )
    }
  } else {
    const hasBalances = typeof f.openingCents === 'number' && typeof f.closingCents === 'number'
    body = (
      <>
        {period ? <TicketRow label="Período" value={period} /> : null}
        <TicketRow label="Movimientos" value={formatCount(f.items)} />
        <TicketRule />
        {hasBalances ? (
          <TicketRow label="Saldo al empezar" value={formatCents(f.openingCents)} />
        ) : null}
        {f.inCents !== undefined ? (
          <TicketRow label="+ Entró" value={formatCents(f.inCents)} />
        ) : null}
        {f.outCents !== undefined ? (
          <TicketRow label="− Salió" value={formatCents(f.outCents)} />
        ) : null}
        {hasBalances ? (
          <>
            <TicketRule double />
            <TicketTotal label="Saldo al terminar" value={formatCents(f.closingCents)} />
          </>
        ) : null}
      </>
    )
    if (f.balance === 'ok') notes.push('La cuenta cierra con lo que dice el archivo.')
    if (f.balance === 'mismatch') {
      notes.push(
        typeof f.balanceDiffCents === 'number'
          ? `No cierra por ${formatCents(Math.abs(f.balanceDiffCents))}: lo subo igual y te lo marco para revisar.`
          : (f.mismatchRows ?? 0) > 0
            ? `El saldo no cierra en ${f.mismatchRows === 1 ? '1 renglón' : `${f.mismatchRows} renglones`}: lo subo igual, revisá esas fechas.`
            : 'La cuenta no cierra: lo subo igual y te lo marco para revisar.',
      )
    }
    if ((f.reserveCents ?? 0) > 0) {
      notes.push(`Mercado Pago todavía tiene retenidos ${formatCents(f.reserveCents)}.`)
    }
    if ((f.guessed ?? 0) > 0) {
      notes.push(
        f.guessed === 1
          ? 'En 1 movimiento no sé bien si entró o salió: te lo marco.'
          : `En ${f.guessed} movimientos no sé bien si entró o salió: te los marco.`,
      )
    }
  }

  const total = plan.rows.length
  const start = booksStartDate ? formatDayMonth(booksStartDate) : ''
  const startNote =
    beforeStart > 0 && start
      ? beforeStart >= total
        ? `Este archivo es todo de antes del ${start}. No hay nada para cargar.`
        : `${beforeStart === 1 ? '1 es' : `${beforeStart} son`} de antes del ${start}, cuando arrancan tus números: ${beforeStart === 1 ? 'ese no se va' : 'esos no se van'} a poder cargar (lo de antes va en los saldos iniciales).`
      : null

  return (
    <Ticket className={className} aria-label="Lo que trae el archivo">
      <TicketHeader title="Llegó esto" subtitle={plan.fileName}>
        {plan.source === 'arca_recibidos' ? (
          <TicketStamp tone="factura">Con factura</TicketStamp>
        ) : null}
      </TicketHeader>
      <TicketRule />
      {body}
      {startNote ? (
        <TicketNote className="rounded-md bg-warning/15 px-3 py-2 font-medium text-adm-paper-ink">
          {startNote}
        </TicketNote>
      ) : null}
      {notes.map((note) => (
        <TicketNote key={String(note)}>{note}</TicketNote>
      ))}
    </Ticket>
  )
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
}
