'use client'

import type { ReactNode } from 'react'
import { EntryPreview } from '@/components/administracion/entry-preview'
import {
  MoneyTicker,
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

export type PurchaseTicketRow = {
  key: string
  label: ReactNode
  value: ReactNode
  hint?: ReactNode
}

/**
 * El ticket de la compra: lo que se está por cargar, en palabras, armándose
 * solo al costado mientras se contestan las cuatro preguntas. A quién, con qué
 * papel (su sello), en qué, cuánto «le vas a deber» y hasta cuándo.
 *
 * Reemplaza a la columna fija «Asiento que se va a generar»: el asiento sigue
 * estando, plegado debajo («Ver cómo queda en los libros»), para quien quiera
 * mirarlo. Con datos faltantes igual se dibuja, en borrador: «—» y, en la letra
 * chica, lo que falta. Nunca «$ 0».
 *
 * El sello dice qué papel es (el mismo mapa de toda la sección, `voucherStamp`):
 * «Con factura A» en verde o «Sin factura» en azul; ninguno es alarma.
 */
export function PurchaseTicket({
  supplier,
  subtitle,
  stamp,
  stampNonce,
  rows,
  totalLabel,
  totalCents,
  totalHint,
  note,
  pending,
  entries,
  books = true,
  className,
}: {
  /** A quién: `null` mientras no se eligió. */
  supplier: string | null
  /** «Compra del lun 12/10». */
  subtitle: string
  /** `null` mientras no hay papel elegido: sin sello. */
  stamp: PaperStamp | null
  /** Sube cada vez que la persona toca un papel: el sello entra de nuevo. En 0, quieto. */
  stampNonce: number
  rows: readonly PurchaseTicketRow[]
  totalLabel: string
  /** `null` = todavía sin importe («—»). */
  totalCents: number | null
  totalHint?: ReactNode
  note: ReactNode
  /** Falta algo: el papel se ve en borrador. */
  pending: boolean
  /** La vista previa del asiento, para el plegado de abajo. */
  entries: Parameters<typeof EntryPreview>[0]['entries']
  /** `false` para no repetir el plegado (la hoja del celular lo muestra una vez). */
  books?: boolean
  className?: string
}) {
  return (
    <div className={cn('space-y-3', className)}>
      <Ticket aria-label="Lo que vas a cargar" className="mx-auto w-full max-w-[22rem]">
        <TicketHeader
          title={supplier ?? 'Proveedor'}
          subtitle={subtitle}
          className={cn((pending || supplier === null) && 'opacity-70')}
        >
          {stamp ? (
            <TicketStamp key={stampNonce} tone={stamp.tone} animate={stampNonce > 0}>
              {stamp.text}
            </TicketStamp>
          ) : null}
        </TicketHeader>
        <TicketRule />
        {rows.map((row) => (
          <TicketRow key={row.key} label={row.label} value={row.value} hint={row.hint} />
        ))}
        {rows.length > 0 ? <TicketRule double /> : null}
        <TicketTotal
          label={totalLabel}
          value={
            totalCents !== null && totalCents > 0 ? (
              <MoneyTicker
                cents={totalCents}
                decimals={totalCents % 100 === 0 ? 0 : 2}
                durationMs={380}
                align="end"
              />
            ) : (
              <>
                <span aria-hidden>—</span>
                <span className="sr-only">Todavía sin importe</span>
              </>
            )
          }
          hint={totalHint}
        />
        {/* En borrador, la letra chica es lo que falta: va con la tinta del papel, no en gris. */}
        <TicketNote className={cn(pending && 'font-medium text-foreground')}>{note}</TicketNote>
      </Ticket>
      {books ? (
        <EntryPreview
          entries={entries}
          label="Ver cómo queda en los libros"
          emptyText="Completá a quién, qué papel y cuánto para ver cómo queda en los libros."
          className="mx-auto w-full max-w-[22rem]"
        />
      ) : null}
    </div>
  )
}
