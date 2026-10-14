'use client'

import { EntryPreview } from '@/components/administracion/entry-preview'
import { Explain, MathRow } from '@/components/administracion/kit/explain'
import { MoneyTicker } from '@/components/administracion/kit/money-ticker'
import {
  Ticket,
  TicketHeader,
  TicketNote,
  TicketRow,
  TicketRule,
  TicketTotal,
} from '@/components/administracion/kit/ticket'
import type { EntryPreview as EntryPreviewModel } from '@/lib/accounting/types'
import { formatCents } from '@/lib/money'
import type { OpeningTotals } from '../_lib/opening'

/**
 * El ticket de los saldos iniciales: «Lo que había» el primer día, que se arma
 * solo mientras se cargan los importes (como el del cierre del día).
 *
 * El número que manda es «En las cajas»: es con lo que van a arrancar las cajas
 * del Resumen. Lo que te debían y lo que debías van debajo, y el «punto de
 * partida» (lo que tenías menos lo que debías) queda en «¿Cómo queda?»: no es
 * plata disponible ni un resultado, es la foto del primer día.
 *
 * Vacío no dibuja ceros: «Cargá algún importe y esto se arma solo.» y «—» en
 * el total. Al pie, plegado, cómo queda en los libros (la vista previa del
 * mismo motor que guarda): aparece con el primer importe, no antes (vacío, su
 * sello diría «Falta algo» sin que falte nada).
 */

export type OpeningTicketRow = { id: string; name: string; cents: number }

export function OpeningTicket({
  startDate,
  boxes,
  boxesCents,
  owedToYou,
  youOwed,
  totals,
  entries,
  saved = false,
  showBooks = true,
}: {
  /** «12/10/2026». */
  startDate: string
  /** Las cajas con plata cargada (sin la tarjeta de la empresa). */
  boxes: readonly OpeningTicketRow[]
  /** La suma de las cajas: el total del ticket. */
  boxesCents: number
  /** Lo que te debían: cuántos y cuánto. */
  owedToYou: { count: number; cents: number }
  /** Lo que debías (proveedores y lo que se debía de la tarjeta de la empresa). */
  youOwed: { count: number; cents: number }
  totals: OpeningTotals
  /** La vista previa del asiento, armada por el motor. */
  entries: readonly EntryPreviewModel[]
  /** Recién guardado: el ticket queda con su tilde. */
  saved?: boolean
  /** «Ver cómo queda en los libros», debajo. */
  showBooks?: boolean
}) {
  const empty =
    boxes.length === 0 &&
    owedToYou.count === 0 &&
    youOwed.count === 0 &&
    totals.assetsCents === 0 &&
    totals.liabilitiesCents === 0
  const negative = totals.equityCents < 0

  return (
    <div className="grid gap-3">
      <Ticket aria-label={`Lo que había al ${startDate}`}>
        <TicketHeader title="Lo que había" subtitle={`Al ${startDate}`}>
          {saved ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="size-4">
                <path
                  className="adm-tick adm-tick-draw"
                  d="M5 12.5l4.5 4.5L19 7.5"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Guardado
            </span>
          ) : null}
        </TicketHeader>
        <div className="mt-4">
          <TicketRule />
        </div>
        {empty ? (
          <p className="py-3 text-center text-sm text-muted-foreground text-pretty">
            Cargá algún importe y esto se arma solo.
          </p>
        ) : (
          boxes.map((box) => (
            <TicketRow key={box.id} label={box.name} value={formatCents(box.cents)} />
          ))
        )}
        <TicketRule double />
        <TicketTotal
          label="En las cajas"
          value={
            boxes.length > 0 ? (
              <MoneyTicker cents={boxesCents} decimals={2} durationMs={380} align="end" />
            ) : (
              <>
                <span aria-hidden>—</span>
                <span className="sr-only">Todavía sin importes</span>
              </>
            )
          }
          hint={boxes.length > 0 ? 'Con esto arrancan las cajas del Resumen.' : undefined}
        />
        {owedToYou.count > 0 || youOwed.count > 0 ? (
          <>
            <TicketRule />
            {owedToYou.count > 0 ? (
              <TicketRow
                label={`Te debían (${owedToYou.count})`}
                value={formatCents(owedToYou.cents)}
              />
            ) : null}
            {youOwed.count > 0 ? (
              <TicketRow
                label={`Les debías (${youOwed.count})`}
                value={formatCents(youOwed.cents)}
              />
            ) : null}
          </>
        ) : null}
        {/* Recién guardado, el tilde de arriba ya lo dice: no va «Todavía no está guardado». */}
        {saved ? null : (
          <TicketNote>
            {empty
              ? 'Se guarda una sola vez, con el botón del último paso.'
              : 'Todavía no está guardado: se guarda una sola vez, en el último paso.'}
          </TicketNote>
        )}
      </Ticket>

      {empty ? null : (
        <Explain
          label="¿Cómo queda el punto de partida?"
          note="No es plata disponible ni un resultado: es la foto del primer día. Si queda una diferencia sin asignar, la acomoda la contadora."
        >
          <MathRow label="Lo que tenías" value={formatCents(totals.assetsCents)} />
          <MathRow op="−" label="Lo que debías" value={formatCents(totals.liabilitiesCents)} />
          <MathRow
            op="="
            label="Punto de partida"
            value={
              negative
                ? `Debías ${formatCents(Math.abs(totals.equityCents))} más`
                : formatCents(totals.equityCents)
            }
          />
          {negative ? (
            <p className="pt-1 text-xs text-muted-foreground text-pretty">
              Debías {formatCents(Math.abs(totals.equityCents))} más de lo que tenías.
            </p>
          ) : null}
        </Explain>
      )}

      {showBooks && (!empty || entries.length > 0) ? (
        <EntryPreview
          entries={entries}
          label="Ver cómo queda en los libros"
          emptyText="Cargá algún saldo para ver cómo queda en los libros."
        />
      ) : null}
    </div>
  )
}
