import { ArrowUp, CalendarCheck, Plus, ReceiptText } from 'lucide-react'
import Link from 'next/link'
import { Suspense } from 'react'
import {
  MoneyHero,
  Panel,
  PanelLink,
  PanelSection,
  RetryButton,
  StatusPill,
} from '@/components/administracion/kit'
import { Button } from '@/components/ui/button'
import type { MonthDayState } from '@/lib/accounting/home'
import {
  cashDiffText,
  complianceText,
  type MonthState,
  type ProjectionDay,
} from '@/lib/accounting/projection'
import { type DailyCloseDay, getDocument } from '@/lib/accounting/queries/documents'
import type { CashCountTreasury } from '@/lib/accounting/queries/projection'
import { settleQuery } from '@/lib/accounting/queries/shared'
import { capitalizeFirst, formatDayMonth, weekdayName } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { longDayTitle, nightSentence } from '../_lib/almanac'
import { ExampleTicket } from '../cierre/_components/close-pieces'
import { CloseTicket } from '../cierre/_components/close-ticket'
import { closeTicketProps } from '../cierre/_lib/close-ticket-props'
import { CashCountDialog } from './cash-count-dialog'
import { NoteCell, TargetCell } from './day-cells'
import { NightTicketSkeleton } from './skeletons'

/**
 * La noche elegida: lo que se muestra al lado del almanaque (debajo, en el
 * celular) cuando se toca un día. Una noche cargada trae el MISMO ticket que
 * se armó al cerrarla (`CloseTicket`), con lo que pasó después («ya llegó»,
 * «llega el…»): lo que cargaste ayer lo encontrás igual hoy.
 *
 * El ticket pide el comprobante entero de cada turno (unas quince lecturas),
 * así que va en su propio `Suspense`: el resto de la noche aparece enseguida y
 * al cambiar de día se ve el esqueleto de un ticket, no el ticket viejo.
 *
 * Quien solo mira ve lo mismo sin ningún botón de carga ni celdas editables.
 */

export type NightSheetProps = {
  tenantId: string
  /** `/<bar>/administracion`. */
  base: string
  /** Hoy (`yyyy-MM-dd`): contra esto se dice si algo «llega» o «tendría que haber llegado». */
  today: string
  /** La noche elegida (`defaultDay`); `null` si el mes no tiene ninguna para mostrar. */
  day: string | null
  state: MonthDayState | null
  /** «octubre». */
  monthName: string
  monthState: MonthState
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

/** «miércoles 07/10», para los lectores de pantalla de las celdas que se editan. */
function dayWords(day: string): string {
  return `${weekdayName(day)} ${formatDayMonth(day)}`.trim()
}

const SHEET = 'card-hairline rounded-2xl border bg-card p-4 shadow-xs sm:p-5'
const DAY_TITLE = 'font-serif text-xl font-semibold leading-tight tracking-tight text-balance'

/** El link de vuelta, solo donde la noche queda debajo del almanaque. */
function BackToAlmanac() {
  return (
    <a
      href="#almanaque"
      className="inline-flex min-h-11 items-center gap-1.5 rounded-sm text-sm font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring xl:hidden"
    >
      <ArrowUp aria-hidden className="size-3.5" />
      Volver al almanaque
    </a>
  )
}

/** El objetivo del día (se edita en el lugar) y cómo quedó contra lo vendido. */
function TargetLine({
  day,
  projectionDay,
  canWrite,
  label,
}: {
  day: string
  projectionDay: ProjectionDay | null
  canWrite: boolean
  label: string
}) {
  const target = projectionDay?.targetCents ?? null
  const compliance = projectionDay?.compliance
  const text = compliance?.kind === 'value' ? complianceText(compliance) : null
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex flex-wrap items-center justify-end gap-2">
        {canWrite ? (
          <TargetCell day={day} dayLabel={dayWords(day)} targetCents={target} />
        ) : (
          <span className="text-sm font-medium tabular-nums">
            {target === null ? 'Sin objetivo' : formatCentsShort(target)}
          </span>
        )}
        {text && compliance?.kind === 'value' ? (
          <StatusPill tone={compliance.side === 'below' ? 'warn' : 'ok'}>{text}</StatusPill>
        ) : null}
      </span>
    </div>
  )
}

/** Los eventos del calendario de esa noche y la nota a mano. */
function EventLine({
  day,
  projectionDay,
  events,
  canWrite,
  lead,
}: {
  day: string
  projectionDay: ProjectionDay | null
  events: readonly string[]
  canWrite: boolean
  /** «Esa noche» / «Ese día». */
  lead: string
}) {
  const note = projectionDay?.note ?? null
  if (!canWrite && events.length === 0 && !note) return null
  return (
    <div className="space-y-1">
      {events.length > 0 ? (
        <p className="flex items-start gap-2 text-sm text-pretty">
          <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-adm-s2" />
          <span>
            <span className="text-muted-foreground">{lead}: </span>
            <span className="font-medium">{events.join(' · ')}</span>
          </span>
        </p>
      ) : null}
      {canWrite ? (
        <div className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className="text-muted-foreground">Nota</span>
          <NoteCell day={day} dayLabel={dayWords(day)} note={note} />
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
  const { day, state, base, canWrite, monthName, monthState, projectionDay, events } = props

  // El mes no tiene ninguna noche cargada: se enseña qué va a aparecer, con un ticket de muestra.
  if (!day || !state) {
    const past = monthState === 'past'
    return (
      <div className="space-y-4">
        <Panel
          title={past ? `No se cargó ningún cierre en ${monthName}` : 'El ticket de cada noche'}
        >
          {past ? null : (
            <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
              Cuando {canWrite ? 'cargues' : 'se cargue'} un cierre, tocás ese día en el almanaque y
              acá aparece su ticket: cuánto se vendió, cómo te pagaron y qué día llega cada cosa.
            </p>
          )}
        </Panel>
        {past ? null : (
          <div className="relative">
            <p className="mb-2 text-center text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Ejemplo
            </p>
            <div aria-hidden className="opacity-80">
              <ExampleTicket />
            </div>
          </div>
        )}
        <BackToAlmanac />
      </div>
    )
  }

  const title = longDayTitle(day)

  if (state === 'today' || state === 'future') {
    const today = state === 'today'
    return (
      <div className="space-y-4">
        <Panel>
          <PanelSection>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className={DAY_TITLE}>{title}</h2>
              <StatusPill tone={today ? 'info' : 'muted'}>
                {today ? 'En curso' : 'Todavía no llegó'}
              </StatusPill>
            </div>
            {today ? (
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground text-pretty">
                La noche todavía no terminó. El cierre se carga cuando cierran la caja; para el bar,
                el día cambia a las 5 de la mañana.
              </p>
            ) : null}
            {today && canWrite ? (
              <Button asChild variant="outline" className="mt-3 h-11 gap-2">
                <Link href={`${base}/ventas/cierre?fecha=${day}`}>
                  <CalendarCheck className="size-4" aria-hidden />
                  Cargar el cierre de hoy
                </Link>
              </Button>
            ) : null}
          </PanelSection>
          <PanelSection className="space-y-3">
            <TargetLine
              day={day}
              projectionDay={projectionDay}
              canWrite={canWrite}
              label="Objetivo de ese día"
            />
            <EventLine
              day={day}
              projectionDay={projectionDay}
              events={events}
              canWrite={canWrite}
              lead="Ese día"
            />
          </PanelSection>
        </Panel>
        <BackToAlmanac />
      </div>
    )
  }

  // ── Una noche cargada ──
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
    <div className="space-y-4">
      <section className={SHEET} aria-label={`La noche del ${dayWords(day)}`}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className={DAY_TITLE}>{title}</h2>
          <StatusPill tone="ok">Cargado</StatusPill>
          {props.closes.length > 1 ? (
            <StatusPill tone="muted">{props.closes.length} turnos</StatusPill>
          ) : null}
        </div>
        <MoneyHero
          className="mt-4"
          size="md"
          cents={loadedCents}
          label="Vendido esa noche"
          sentence={sentence}
        />
        {bar > 0 && delivery > 0 ? (
          <p className="mt-3 text-xs tabular-nums text-muted-foreground">
            Salón {formatCentsShort(bar)} · Delivery {formatCentsShort(delivery)}
          </p>
        ) : null}
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

      <Panel>
        <PanelSection className="space-y-3">
          <TargetLine
            day={day}
            projectionDay={projectionDay}
            canWrite={canWrite}
            label="Objetivo de esa noche"
          />
          <EventLine
            day={day}
            projectionDay={projectionDay}
            events={events}
            canWrite={canWrite}
            lead="Esa noche"
          />
        </PanelSection>
        <PanelSection title="Ventas contra caja">
          <div className="rounded-xl bg-secondary/50 p-3">
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
                        ? 'font-medium text-warning-text'
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
              <div className="mt-2">
                <CashCountDialog
                  trigger="button"
                  day={day}
                  dayLabel={dayWords(day)}
                  treasuries={dialogTreasuries}
                  initial={props.counts}
                  salesCents={projectionDay.hasClose ? projectionDay.realCents : null}
                  countedCents={projectionDay.cashCountedCents}
                />
              </div>
            ) : null}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground text-pretty">
            Compara lo vendido en el salón con la plata que entró ese día. No cambia ningún saldo.
          </p>
        </PanelSection>
      </Panel>
      <BackToAlmanac />
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
      <Panel title="No pudimos traer el ticket de esa noche.">
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-sm text-muted-foreground text-pretty">
            {failed && !failed.ok ? failed.message : 'Probá de nuevo en un momento.'}
          </p>
          <RetryButton />
          {vouchers}
        </div>
      </Panel>
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
