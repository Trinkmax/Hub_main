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
  /** Un dato que el sistema propone y nadie eligió todavía: va en la tinta gris del papel. */
  muted?: boolean
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
 * El borrador no afirma lo que nadie eligió: sin proveedor, el título es la
 * pregunta («¿A quién le compraste?», en gris) y no un nombre; y mientras nadie
 * tocó un papel ni eligió a quién (`stampDraft`), el sello es solo su contorno
 * punteado: se ve dónde va, no se lee como dicho.
 *
 * El sello dice qué papel es (el mismo mapa de toda la sección, `voucherStamp`):
 * «Con factura A» en verde o «Sin factura» en azul; ninguno es alarma.
 *
 * Los importes van como en un tique de verdad: si alguno tiene centavos, los
 * llevan todos; si son todos redondos, ninguno (`withCents`, la regla del
 * ticket del cierre del día).
 */
export function PurchaseTicket({
  supplier,
  subtitle,
  stamp,
  stampNonce,
  stampDraft = false,
  rows,
  totalLabel,
  totalCents,
  withCents = false,
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
  /** El papel es solo el que propone el sistema (sin proveedor ni papel tocado): sello en contorno. */
  stampDraft?: boolean
  rows: readonly PurchaseTicketRow[]
  totalLabel: string
  /** `null` = todavía sin importe («—»). */
  totalCents: number | null
  /** Algún importe del ticket tiene centavos: el total los muestra también. */
  withCents?: boolean
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
          title={
            supplier ?? (
              // La pregunta, no un nombre: «Proveedor» de título parecía uno ya elegido.
              <span className="font-normal text-muted-foreground">¿A quién le compraste?</span>
            )
          }
          subtitle={subtitle}
          className={cn(pending && supplier !== null && 'opacity-70')}
        >
          {stamp ? (
            <TicketStamp
              key={stampNonce}
              tone={stamp.tone}
              animate={stampNonce > 0}
              className={cn(stampDraft && 'border-2 border-dashed opacity-40')}
            >
              {stamp.text}
            </TicketStamp>
          ) : null}
        </TicketHeader>
        <TicketRule />
        {rows.map((row) => (
          <TicketRow
            key={row.key}
            label={row.label}
            value={row.value}
            hint={row.hint}
            muted={row.muted}
          />
        ))}
        {rows.length > 0 ? <TicketRule double /> : null}
        <TicketTotal
          label={totalLabel}
          value={
            totalCents !== null && totalCents > 0 ? (
              <MoneyTicker
                cents={totalCents}
                decimals={withCents ? 2 : 0}
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
