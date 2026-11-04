import { Plus, ReceiptText } from 'lucide-react'
import { Suspense } from 'react'
import { PanelLink, RetryButton, StatusPill } from '@/components/administracion/kit'
import { cashDiffText, type ProjectionDay } from '@/lib/accounting/projection'
import { type DailyCloseDay, getDocument } from '@/lib/accounting/queries/documents'
import type { CashCountTreasury } from '@/lib/accounting/queries/projection'
import { settleQuery } from '@/lib/accounting/queries/shared'
import { capitalizeFirst } from '@/lib/dates'
import { formatCents, formatCentsShort } from '@/lib/money'
import { longDay, longDayTitle, nightPaceText, nightSentence } from '../_lib/planilla'
import { CloseTicket } from '../cierre/_components/close-ticket'
import { closeTicketProps } from '../cierre/_lib/close-ticket-props'
import { CashCountDialog } from './cash-count-dialog'
import { NoteCell, TargetCell } from './day-cells'
import { NightTicketSkeleton } from './skeletons'

/**
 * El detalle de una noche con su cierre: lo que se abre al tocar «Ver cierre» en la planilla. Trae el
 * MISMO ticket que se armó al cerrarla (`CloseTicket`), con lo que pasó después («ya llegó», «llega
 * el…»), y al lado el objetivo, el evento y lo que entró por caja.
 *
 * El ticket pide el comprobante entero de cada turno (unas quince lecturas), así que va en su propio
 * `Suspense`: el resto de la noche aparece enseguida.
 *
 * Quien solo mira ve lo mismo sin ningún botón de carga ni celdas que se escriban.
 */

export type NightSheetProps = {
  tenantId: string
  /** `/<bar>/administracion`. */
  base: string
  /** Hoy (`yyyy-MM-dd`): contra esto se dice si algo «llega» o «tendría que haber llegado». */
  today: string
  /** La noche abierta. */
  day: string
  /** «octubre». */
  monthName: string
  projectionDay: ProjectionDay | null
  /** Los cierres de esa noche (uno por turno). */
  closes: DailyCloseDay['closes']
  /** Los eventos del calendario de esa noche (vacío para quien no lee el calendario). */
  events: readonly string[]
  /** Lo ya anotado que entró esa noche, por caja. */
  counts: Readonly<Record<string, number>>
  treasuries: readonly CashCountTreasury[]
  canWrite: boolean
}

const SECTION = 'space-y-3 border-t border-border/70 pt-4'

/** El objetivo del día (se escribe en el lugar) y cómo quedó contra lo vendido. */
function TargetLine({
  day,
  projectionDay,
  canWrite,
}: {
  day: string
  projectionDay: ProjectionDay | null
  canWrite: boolean
}) {
  const target = projectionDay?.targetCents ?? null
  const compliance = projectionDay?.compliance
  // Una sola cosa en la pastilla: «16 % abajo del objetivo» (no «84 % · 16 % abajo»).
  const pace = compliance?.kind === 'value' ? compliance : null
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <span className="text-sm text-muted-foreground">Objetivo de esa noche</span>
      <span className="flex flex-wrap items-center justify-end gap-2">
        {canWrite ? (
          <TargetCell day={day} dayLabel={longDay(day)} targetCents={target} />
        ) : (
          <span className="text-sm font-medium tabular-nums">
            {target === null ? 'Sin objetivo' : formatCentsShort(target)}
          </span>
        )}
        {pace ? (
          <StatusPill tone={pace.side === 'below' ? 'warn' : 'ok'}>
            {nightPaceText(pace)}
          </StatusPill>
        ) : null}
      </span>
    </div>
  )
}

/** Los eventos del calendario de esa noche y la nota a mano. */
function EventLine({
  day,
  note,
  events,
  canWrite,
}: {
  day: string
  note: string | null
  events: readonly string[]
  canWrite: boolean
}) {
  if (!canWrite && events.length === 0 && !note) return null
  return (
    <div className="space-y-1">
      {events.length > 0 ? (
        <p className="text-sm text-pretty">
          <span className="text-muted-foreground">Esa noche: </span>
          <span className="font-medium">{events.join(' · ')}</span>
        </p>
      ) : null}
      {canWrite ? (
        <div className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className="text-muted-foreground">Nota</span>
          <NoteCell day={day} dayLabel={longDay(day)} note={note} />
        </div>
      ) : note ? (
        <p className="text-sm text-pretty">
          <span className="text-muted-foreground">Nota: </span>
          {note}
        </p>
      ) : null}
    </div>
  )
}

export function NightSheet(props: NightSheetProps) {
  const { day, base, canWrite, monthName, projectionDay, events } = props
  const loadedCents = props.closes.reduce((sum, close) => sum + close.totalCents, 0)
  const netCents = projectionDay?.netCents ?? loadedCents
  const sentence = nightSentence({ loadedCents, netCents })
  const bar = projectionDay?.barCents ?? 0
  const delivery = projectionDay?.deliveryCents ?? 0
  const cash = projectionDay?.cash
  const dialogTreasuries = props.treasuries.filter(
    (t) => t.active || props.counts[t.id] !== undefined,
  )

  return (
    <div className="grid gap-4">
      <section aria-label={`La noche del ${longDay(day)}`} className="space-y-3">
        {/* A la derecha va la X de la hoja: el título no se le mete abajo. */}
        <div className="flex flex-wrap items-center gap-2 pr-8">
          <h2 className="font-serif text-xl leading-tight font-semibold tracking-tight text-balance">
            {longDayTitle(day)}
          </h2>
          {props.closes.length > 1 ? (
            <StatusPill tone="muted">{props.closes.length} turnos</StatusPill>
          ) : null}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Vendido esa noche</p>
          <p className="text-2xl leading-tight font-semibold tracking-tight tabular-nums">
            {formatCents(loadedCents, { decimals: loadedCents % 100 === 0 ? 0 : 2 })}
          </p>
          {sentence ? (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground text-pretty">
              {sentence}
            </p>
          ) : null}
          {bar > 0 && delivery > 0 ? (
            <p className="mt-1 text-xs tabular-nums text-muted-foreground">
              Salón {formatCentsShort(bar)} · Delivery {formatCentsShort(delivery)}
            </p>
          ) : null}
        </div>
      </section>

      <Suspense fallback={<NightTicketSkeleton />}>
        <NightTicket
          tenantId={props.tenantId}
          base={base}
          today={props.today}
          day={day}
          monthName={monthName}
          closes={props.closes}
          canWrite={canWrite}
        />
      </Suspense>

      <section className={SECTION}>
        <TargetLine day={day} projectionDay={projectionDay} canWrite={canWrite} />
        <EventLine
          day={day}
          note={projectionDay?.note ?? null}
          events={events}
          canWrite={canWrite}
        />
      </section>

      <section className={SECTION}>
        <h3 className="text-sm font-semibold">Ventas contra caja</h3>
        {cash?.kind === 'compared' && projectionDay ? (
          <p className="text-sm text-pretty">
            Entró ese día{' '}
            <span className="font-medium tabular-nums">
              {formatCentsShort(projectionDay.cashCountedCents)}
            </span>
            {' · '}
            <span
              className={
                cash.diffCents === 0
                  ? 'font-medium text-success'
                  : cash.diffCents < 0
                    ? 'font-medium text-destructive'
                    : 'font-medium'
              }
            >
              {cashDiffText(cash.diffCents)}
            </span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground text-pretty">
            Todavía no {canWrite ? 'anotaste' : 'se anotó'} lo que entró ese día.
          </p>
        )}
        {canWrite && projectionDay ? (
          <CashCountDialog
            trigger="button"
            day={day}
            dayLabel={longDay(day)}
            treasuries={dialogTreasuries}
            initial={props.counts}
            salesCents={projectionDay.hasClose ? projectionDay.realCents : null}
            countedCents={projectionDay.cashCountedCents}
          />
        ) : null}
        <p className="text-xs leading-relaxed text-muted-foreground text-pretty">
          Compara lo vendido en el salón con la plata que entró ese día. No cambia ningún saldo.
        </p>
      </section>
    </div>
  )
}

/** El ticket de la noche y lo que se puede hacer con su cierre. */
async function NightTicket({
  tenantId,
  base,
  today,
  day,
  monthName,
  closes,
  canWrite,
}: {
  tenantId: string
  base: string
  today: string
  day: string
  monthName: string
  closes: DailyCloseDay['closes']
  canWrite: boolean
}) {
  const results = await Promise.all(
    closes.map((close) => settleQuery(getDocument(tenantId, close.id))),
  )
  const docs = results.flatMap((result) => (result.ok && result.data ? [result.data] : []))
  const links = closes.map((close) => ({
    id: close.id,
    label:
      closes.length === 1
        ? 'Ver el comprobante'
        : `Ver el turno «${close.shift?.trim() || String(close.seq)}»`,
  }))
  const vouchers = (
    <ul className="flex flex-wrap gap-x-4 gap-y-1">
      {links.map((link) => (
        <li key={link.id}>
          <PanelLink href={`${base}/comprobantes/${link.id}`}>
            <ReceiptText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            {link.label}
          </PanelLink>
        </li>
      ))}
    </ul>
  )

  if (docs.length !== closes.length) {
    const failed = results.find((result) => !result.ok)
    return (
      <div className="flex flex-col items-start gap-3 border-t border-border/70 pt-4">
        <p className="text-sm font-semibold">No pudimos traer el ticket de esa noche.</p>
        <p role="alert" className="text-sm text-muted-foreground text-pretty">
          {failed && !failed.ok ? failed.message : 'Probá de nuevo en un momento.'}
        </p>
        <RetryButton />
        {vouchers}
      </div>
    )
  }

  const monthClosed = docs.some((doc) => doc.period?.status === 'closed')
  return (
    <div className="space-y-3">
      {/* El objetivo va fuera del papel, con la cuenta de los socios (sobre la venta neta):
          dos porcentajes distintos para la misma noche no van. */}
      <CloseTicket {...closeTicketProps(docs, { today, arrivals: true })} target={null} />
      <div className="space-y-1 px-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {vouchers}
          {canWrite && !monthClosed ? (
            <PanelLink href={`${base}/ventas/cierre?fecha=${day}`}>
              <Plus aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              Cargar otro turno
            </PanelLink>
          ) : null}
        </div>
        {monthClosed ? (
          <p className="text-xs leading-relaxed text-muted-foreground text-pretty">
            {capitalizeFirst(monthName)} está cerrado: este cierre ya no se cambia.
          </p>
        ) : canWrite ? (
          <p className="text-xs leading-relaxed text-muted-foreground text-pretty">
            Para corregirlo, abrilo y anulalo; después cargalo de nuevo.
          </p>
        ) : null}
      </div>
    </div>
  )
}
