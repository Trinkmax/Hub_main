import type { ReactNode } from 'react'
import { moneyLabel } from '@/components/administracion/cajas-ventas/money'
import { MoneyTicker } from '@/components/administracion/kit/money-ticker'
import {
  Ticket,
  TicketHeader,
  TicketNote,
  TicketRow,
  TicketRule,
  TicketStamp,
  TicketTotal,
} from '@/components/administracion/kit/ticket'
import { cashDiffText } from '@/lib/accounting/projection'
import type { ArrivalLine, InvoiceSplit, TargetProgress } from '../_lib/close-view'

export type CloseTicketCash = {
  /** Lo vendido en efectivo: lo que tendría que haber en la caja. */
  expectedCents: number
  /** Lo contado (`null`: no se contó, o se salteó el paso). */
  countedCents: number | null
  /** Vendido − contado, como lo calcula el formulario: positivo = falta. */
  diffCents: number
}

export type CloseTicketProps = {
  /** «miércoles 07/10/2026». */
  dayTitle: string
  /** «noche», si es otro turno del mismo día. */
  shift: string | null
  /** Los medios con importe, en el orden de la pantalla. */
  lines: ReadonlyArray<{ id: string; name: string; cents: number }>
  soldCents: number
  /** «Salón $ 1.490.000 · Delivery $ 210.000», si se vendió por más de un canal. */
  channelsText: string | null
  /** `null`: hay un importe fuera de rango y todavía no se puede repartir. */
  split: InvoiceSplit | null
  /** `null`: el bar no tiene un medio en efectivo. */
  cash: CloseTicketCash | null
  arrivals: readonly ArrivalLine[]
  target: TargetProgress | null
  className?: string
}

/** El rótulo de un bloque del ticket («EFECTIVO», «CUÁNDO ENTRA»), como los de un tique. */
function TicketLabel({ children }: { children: ReactNode }) {
  return (
    <p className="pb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </p>
  )
}

function stampOf(split: InvoiceSplit | null): { tone: 'factura' | 'sin'; text: string } | null {
  if (!split) return null
  switch (split.kind) {
    case 'none':
      return { tone: 'sin', text: 'Sin factura' }
    case 'mixed':
      return { tone: 'factura', text: `${split.invoicedPercent} % con factura` }
    case 'all':
      return { tone: 'factura', text: 'Todo con factura' }
    // Vacío no lleva sello; «facturado de más» es un aviso, no un sello.
    case 'empty':
    case 'over':
      return null
  }
}

/**
 * El ticket del cierre, que se arma solo mientras se cargan los importes: los
 * medios con plata, el total, cuánto fue con factura y cuánto sin, el arqueo
 * del efectivo, cuándo entra cada cosa y el objetivo del día. Todos los
 * números llegan calculados por el formulario (los mismos que arman el
 * asiento): acá solo se dibujan.
 *
 * Vacío también enseña: muestra los renglones que van a aparecer, con «—»
 * (nunca «$ 0»: cero no es «todavía no cargué»).
 */
export function CloseTicket({
  dayTitle,
  shift,
  lines,
  soldCents,
  channelsText,
  split,
  cash,
  arrivals,
  target,
  className,
}: CloseTicketProps) {
  const stamp = stampOf(split)
  const hasSales = soldCents > 0
  const showCash = cash !== null && (cash.expectedCents > 0 || cash.countedCents !== null)

  return (
    <Ticket className={className} aria-label={`Ticket del cierre del ${dayTitle}`}>
      <TicketHeader title="Cierre del día" subtitle={shift ? `${dayTitle} · ${shift}` : dayTitle}>
        {stamp ? (
          // La clave es la CLASE de sello (sin, con, todo): se vuelve a sellar
          // cuando cambia eso, no con cada tecla que mueve el porcentaje.
          <TicketStamp key={split?.kind} tone={stamp.tone} animate>
            {stamp.text}
          </TicketStamp>
        ) : null}
      </TicketHeader>

      <TicketRule />
      {lines.length === 0 ? (
        <p className="py-2 text-center text-sm text-muted-foreground text-pretty">
          Cargá los importes y el ticket se arma solo.
        </p>
      ) : (
        lines.map((line) => (
          <TicketRow key={line.id} label={line.name} value={moneyLabel(line.cents)} />
        ))
      )}

      <TicketRule double />
      <TicketTotal
        label="Total vendido"
        value={
          hasSales ? (
            <MoneyTicker
              cents={soldCents}
              decimals={soldCents % 100 === 0 ? 0 : 2}
              durationMs={380}
              align="end"
            />
          ) : (
            '—'
          )
        }
        hint={channelsText}
      />

      <TicketRule />
      <TicketRow
        label="Con factura"
        muted={!split || split.invoicedCents === 0}
        value={split && split.kind !== 'empty' ? moneyLabel(split.invoicedCents) : '—'}
      />
      <TicketRow
        label="Sin factura"
        muted={!split || split.uninvoicedCents === 0}
        value={split && split.kind !== 'empty' ? moneyLabel(split.uninvoicedCents) : '—'}
      />
      {split?.kind === 'over' ? (
        <TicketRow
          strong
          label="Facturado de más"
          hint="Al guardar te preguntamos por qué."
          value={moneyLabel(split.overCents)}
        />
      ) : null}

      {showCash && cash ? (
        <>
          <TicketRule />
          <TicketLabel>Efectivo</TicketLabel>
          <TicketRow label="Debería haber" value={moneyLabel(cash.expectedCents)} />
          <TicketRow
            label="Contaste"
            muted={cash.countedCents === null}
            value={cash.countedCents === null ? 'sin contar' : moneyLabel(cash.countedCents)}
          />
          {cash.countedCents !== null ? (
            // `cashDiffText` habla desde lo que entró: negativo es que falta.
            <TicketRow strong label="Diferencia" value={cashDiffText(-cash.diffCents)} />
          ) : null}
        </>
      ) : null}

      {arrivals.length > 0 ? (
        <>
          <TicketRule />
          <TicketLabel>Cuándo entra</TicketLabel>
          {arrivals.map((line) => (
            <TicketRow key={line.key} label={line.label} value={moneyLabel(line.cents)} />
          ))}
        </>
      ) : null}

      {target ? (
        <>
          <TicketRule />
          <TicketRow
            label="Objetivo del día"
            hint={
              hasSales
                ? `Con esto vas en el ${target.percent} %, antes de comisiones.`
                : 'Cargá lo vendido para ver cómo te fue.'
            }
            value={moneyLabel(target.targetCents)}
          />
        </>
      ) : null}

      <TicketNote>Con factura o sin factura, todo queda registrado en los libros.</TicketNote>
    </Ticket>
  )
}
