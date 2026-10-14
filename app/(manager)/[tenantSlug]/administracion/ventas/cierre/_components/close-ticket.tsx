import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { MoneyTicker } from '@/components/administracion/kit/money-ticker'
import {
  Ticket,
  TicketHeader,
  TicketLabel,
  TicketNote,
  TicketRow,
  TicketRule,
  TicketStamp,
  TicketTotal,
} from '@/components/administracion/kit/ticket'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { ArrivalLine, InvoiceSplit, TargetProgress } from '../_lib/close-view'

export type CloseTicketCash = {
  /** Lo vendido en efectivo: lo que tendría que haber en la caja. */
  expectedCents: number
  /** Lo contado (`null`: no se contó, o se salteó el paso). */
  countedCents: number | null
  /** Vendido − contado, como lo calcula el formulario: positivo = falta. */
  diffCents: number
}

/**
 * Un renglón de «Cuándo entra». En un cierre ya guardado lleva además, en
 * chico, qué pasó con esa plata («ya llegó», «llega el vie 16/10»).
 */
export type CloseTicketArrival = ArrivalLine & { hint?: string }

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
  /**
   * Ya se sabe qué se facturó: el bar no tiene puntos de venta (todo queda sin
   * factura, siempre) o la persona anotó algo en «¿Qué facturaste?». Mientras
   * no, el ticket no sella nada ni afirma «con factura $ 0».
   */
  invoiceAsked: boolean
  /**
   * `null`: el bar no tiene un medio en efectivo. En un cierre ya guardado,
   * también cuando no quedó conteo (coincidió, o no se contó).
   */
  cash: CloseTicketCash | null
  arrivals: readonly CloseTicketArrival[]
  target: TargetProgress | null
  /**
   * Va pegado al costado en la compu: si la pantalla es baja (una notebook) se
   * aprieta un poco y pliega «Cuándo entra», para entrar entero con su borde
   * dentado. Con lugar de sobra se ve igual que siempre.
   */
  compact?: boolean
  /**
   * Un cierre YA guardado, que solo se mira (la noche elegida en Ventas, la
   * ficha del comprobante): el papel va quieto. El sello no entra de un
   * sellazo, el total no cuenta y no habla de «al guardar». Mientras se carga
   * un cierre, no se pasa. `closeTicketProps()` ya lo trae puesto.
   */
  still?: boolean
  /**
   * Lo que sigue a la letra chica, dentro del mismo papel: el detalle y quién
   * lo cargó, en la ficha del comprobante. Empezalo con un `TicketRule` y usá
   * piezas `Ticket*`; no metas botones (las acciones van afuera del papel).
   */
  footer?: ReactNode
  className?: string
}

// Las tres reglas de «pantalla baja» del ticket pegado. Van escritas enteras:
// Tailwind no ve clases armadas por partes.
const SHORT_RULES = '[@media(max-height:960px)]:[&_hr]:my-2'
const SHORT_ROWS = '[@media(max-height:960px)]:[&>div]:py-0.5'
const SHORT_ONLY = 'hidden [@media(max-height:960px)]:block'
const TALL_ONLY = '[@media(max-height:960px)]:hidden'

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
 *
 * Es también el papel de un cierre ya guardado: con las props que arma
 * `closeTicketProps()` (`../_lib/close-ticket-props.ts`) desde el comprobante,
 * lo que se cargó ayer se encuentra igual hoy. Ahí va `still` y, si hace
 * falta, `footer`.
 *
 * Cuándo NO: para otro comprobante (una compra, un cobro: cada uno arma su
 * ticket con las piezas `Ticket*` y su sello sale de `voucherStamp()`), ni
 * para el resumen del mes (eso es la carátula de Libros).
 */
export function CloseTicket({
  dayTitle,
  shift,
  lines,
  soldCents,
  channelsText,
  split,
  invoiceAsked,
  cash,
  arrivals,
  target,
  compact = false,
  still = false,
  footer,
  className,
}: CloseTicketProps) {
  // El sello se pone cuando hay algo que sellar: antes de «¿Qué facturaste?»
  // sería un veredicto que nadie dio.
  const stamp = invoiceAsked ? stampOf(split) : null
  const hasSales = soldCents > 0
  const hasSplit = split !== null && split.kind !== 'empty'
  const showCash = cash !== null && (cash.expectedCents > 0 || cash.countedCents !== null)

  // Como un tique de verdad: si algún importe tiene centavos, los llevan todos
  // (las comas quedan una abajo de la otra); si son todos redondos, ninguno.
  const withCents = [
    ...lines.map((line) => line.cents),
    soldCents,
    split?.invoicedCents ?? 0,
    split?.uninvoicedCents ?? 0,
    split?.overCents ?? 0,
    cash?.countedCents ?? 0,
    ...arrivals.map((line) => line.cents),
    target?.targetCents ?? 0,
  ].some((cents) => cents % 100 !== 0)
  const decimals = withCents ? 2 : 0
  const money = (cents: number) => formatCents(cents, { decimals })

  const rows = (children: ReactNode) => (
    <div className={compact ? SHORT_ROWS : undefined}>{children}</div>
  )
  const arrivalRows = arrivals.map((line) => (
    <TicketRow key={line.key} label={line.label} hint={line.hint} value={money(line.cents)} />
  ))

  return (
    <Ticket
      className={cn(compact && SHORT_RULES, className)}
      aria-label={`Ticket del cierre del ${dayTitle}`}
    >
      <TicketHeader title="Cierre del día" subtitle={shift ? `${dayTitle} · ${shift}` : dayTitle}>
        {stamp ? (
          // La clave es la CLASE de sello (sin, con, todo): se vuelve a sellar
          // cuando cambia eso, no con cada tecla que mueve el porcentaje. En un
          // cierre que solo se mira no hay sellazo: nadie acaba de sellar nada.
          <TicketStamp key={split?.kind} tone={stamp.tone} animate={!still}>
            {stamp.text}
          </TicketStamp>
        ) : null}
      </TicketHeader>

      <TicketRule />
      {lines.length === 0 ? (
        <p className="py-2 text-center text-sm text-muted-foreground text-pretty">
          {still
            ? 'Este cierre no tiene importes cargados.'
            : 'Cargá los importes y el ticket se arma solo.'}
        </p>
      ) : (
        rows(
          lines.map((line) => (
            <TicketRow key={line.id} label={line.name} value={money(line.cents)} />
          )),
        )
      )}

      <TicketRule double />
      <TicketTotal
        label="Total vendido"
        value={
          !hasSales ? (
            '—'
          ) : still ? (
            money(soldCents)
          ) : (
            <MoneyTicker cents={soldCents} decimals={decimals} durationMs={380} align="end" />
          )
        }
        hint={channelsText}
      />

      <TicketRule />
      {rows(
        <>
          <TicketRow
            label="Con factura"
            muted={!hasSplit || !invoiceAsked || split.invoicedCents === 0}
            value={hasSplit && invoiceAsked ? money(split.invoicedCents) : '—'}
          />
          <TicketRow
            label="Sin factura"
            muted={!hasSplit || split.uninvoicedCents === 0}
            value={hasSplit ? money(split.uninvoicedCents) : '—'}
          />
          {split?.kind === 'over' ? (
            <TicketRow
              strong
              label="Facturado de más"
              // Guardado, ya se preguntó: el motivo lo muestra la ficha del comprobante.
              hint={still ? undefined : 'Al guardar te preguntamos por qué.'}
              value={money(split.overCents)}
            />
          ) : null}
        </>,
      )}

      {showCash && cash ? (
        <>
          <TicketRule />
          {/* Lo que debería haber es el renglón «Efectivo» de arriba: acá va solo lo contado. */}
          {rows(
            <>
              <TicketRow
                label="Efectivo contado"
                muted={cash.countedCents === null}
                value={cash.countedCents === null ? 'sin contar' : money(cash.countedCents)}
              />
              {cash.countedCents !== null ? (
                <TicketRow
                  strong
                  label="Diferencia de caja"
                  value={
                    cash.diffCents === 0
                      ? 'Coincide'
                      : `${cash.diffCents > 0 ? 'Faltan' : 'Sobran'} ${money(Math.abs(cash.diffCents))}`
                  }
                />
              ) : null}
            </>,
          )}
        </>
      ) : null}

      {arrivals.length > 0 ? (
        <>
          <TicketRule />
          <div className={compact ? TALL_ONLY : undefined}>
            <TicketLabel className="pb-1">Cuándo entra</TicketLabel>
            {rows(arrivalRows)}
          </div>
          {compact ? (
            <details className={cn('group/when', SHORT_ONLY)}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-sm py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <TicketLabel>Cuándo entra</TicketLabel>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <span className="group-open/when:hidden">Ver</span>
                  <span className="hidden group-open/when:inline">Ocultar</span>
                  <ChevronDown
                    aria-hidden
                    className="size-3.5 transition-transform duration-(--duration-fast) group-open/when:rotate-180 motion-reduce:transition-none"
                  />
                </span>
              </summary>
              <div className={cn('pt-1', SHORT_ROWS)}>{arrivalRows}</div>
            </details>
          ) : null}
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
            value={money(target.targetCents)}
          />
        </>
      ) : null}

      <TicketNote>Con factura o sin factura, todo queda registrado en los libros.</TicketNote>
      {footer}
    </Ticket>
  )
}
