import { ChevronDown, Lock } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  Ticket,
  TicketHeader,
  TicketNote,
  TicketRow,
  TicketRule,
  TicketStamp,
} from '@/components/administracion/kit/ticket'
import { formatDate, formatMonthLabel } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * El papel del mes: lo que el mes dice de sí mismo y dónde va el sello
 * «CERRADO». Es el espejo mensual del ticket del cierre del día (mismo papel,
 * mismo gesto, otra escala): se llena solo con lo que se carga y, al cerrar,
 * recibe el sello.
 *
 * En la compu va a la derecha de los pasos, pegado; en el celular va arriba,
 * plegado en una línea («Septiembre 2026 · Abierto · Vendido $ 31,4 M · IVA
 * $ 4,1 M a pagar») que se abre para ver el papel entero. Server-safe.
 */

export type MonthCoverData = {
  /** `yyyy-MM`. */
  month: string
  closed: boolean
  closedAt: string | null
  /** Lo vendido según los cierres del día; `null` si no hay ninguno cargado (o no se pudo leer). */
  soldCents: number | null
  /** «30 de 30»; `null` si no se pudo leer el almanaque. */
  daysText: string | null
  /** «$ 4.117.062 a pagar» · «$ 120.000 a favor»; `null` si no hay IVA o no aplica. */
  ivaText: string | null
  /** El bar liquida IVA: si no, el renglón no se dibuja. */
  ivaApplies: boolean
  /** El sello recién puesto (el mes se cerró hace instantes): entra como un sellazo. */
  justClosed?: boolean
}

/** La línea del celular: lo mismo que el papel, en un renglón. */
export function coverLine(
  data: MonthCoverData,
  short: { sold: string | null; iva: string | null },
): string {
  return [
    formatMonthLabel(data.month),
    data.closed ? 'Cerrado' : 'Abierto',
    short.sold ? `Vendido ${short.sold}` : null,
    short.iva ? `IVA ${short.iva}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

function CoverPaper({ data, className }: { data: MonthCoverData; className?: string }) {
  const stamp = data.closedAt ? `Cerrado · ${formatDate(data.closedAt)}` : 'Cerrado'
  return (
    <Ticket className={className} aria-label={`Fin de mes de ${formatMonthLabel(data.month)}`}>
      <TicketHeader title={formatMonthLabel(data.month)} subtitle="Fin de mes">
        {data.closed ? (
          <TicketStamp tone="ok" icon={Lock} animate={data.justClosed}>
            {stamp}
          </TicketStamp>
        ) : (
          <span className="rounded-md border border-dashed border-adm-paper-rule px-3 py-1.5 text-xs text-muted-foreground">
            Acá va el sello cuando lo cierres
          </span>
        )}
      </TicketHeader>
      <TicketRule />
      {data.soldCents !== null ? (
        // Solo los cierres del día: «El IVA del mes» suma además las facturas cargadas aparte, y
        // sin esta aclaración un socio veía dos «vendido» distintos para el mismo mes.
        <TicketRow
          label="Vendido en los cierres del día"
          hint="sin las facturas cargadas aparte"
          value={formatCentsShort(data.soldCents)}
        />
      ) : (
        <TicketRow label="Vendido" hint="sin cierres cargados" value="—" muted />
      )}
      <TicketRow
        label="Días con cierre"
        value={data.daysText ?? '—'}
        muted={data.daysText === null}
      />
      {data.ivaApplies ? (
        <TicketRow
          label="IVA del mes"
          hint={data.closed ? undefined : 'estimado'}
          value={data.ivaText ?? '—'}
          muted={data.ivaText === null}
        />
      ) : null}
      <TicketRule />
      <TicketRow label="Estado" value={data.closed ? 'Cerrado' : 'Abierto'} strong />
      <TicketNote>
        Lo vendido no es lo que te quedó: faltan las compras, los gastos y los impuestos.
      </TicketNote>
    </Ticket>
  )
}

export function MonthCover({
  data,
  mobileLine,
  books,
  booksOpen = false,
  className,
}: {
  data: MonthCoverData
  /** La línea visible del celular (`coverLine`). */
  mobileLine: string
  /** «Cómo queda en los libros»: los totales, la numeración y el asiento del IVA. */
  books?: ReactNode
  /** Abierto de entrada (la contadora): para ella eso es lo que importa. */
  booksOpen?: boolean
  className?: string
}) {
  return (
    <div className={cn('space-y-3', className)}>
      {/* Compu: el papel a la vista. */}
      <CoverPaper data={data} className="hidden lg:block" />

      {/* Celular y tablet: una línea que se abre. */}
      <details className="group/cover card-hairline rounded-2xl border bg-card shadow-xs lg:hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-2xl px-4 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1 font-medium text-pretty">{mobileLine}</span>
          <ChevronDown
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) group-open/cover:rotate-180 motion-reduce:transition-none"
          />
        </summary>
        <div className="px-3 pb-4">
          <CoverPaper data={data} className="mx-auto max-w-sm" />
        </div>
      </details>

      {books ? (
        <details
          open={booksOpen}
          className="group/books card-hairline rounded-2xl border bg-card shadow-xs"
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-2xl px-4 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <ChevronDown
              aria-hidden
              className="size-4 shrink-0 -rotate-90 text-muted-foreground transition-transform duration-(--duration-fast) group-open/books:rotate-0 motion-reduce:transition-none"
            />
            <span className="font-medium">Ver cómo queda en los libros</span>
          </summary>
          <div className="space-y-3 px-4 pb-4 text-sm">{books}</div>
        </details>
      ) : null}
    </div>
  )
}
