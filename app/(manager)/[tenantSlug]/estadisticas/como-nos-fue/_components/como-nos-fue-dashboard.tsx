'use client'

import { CalendarDays, ChevronLeft, ChevronRight, Download, Lock, PartyPopper } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SlidingTabs } from '@/components/ui/sliding-tabs'
import type { MonthBirthdayReport } from '@/lib/salon/birthdays-report'
import { buildEventConsolidated } from '@/lib/salon/event-consolidated'
import { cuadroExport } from '@/lib/salon/event-cuadros'
import { type MonthMarketingReport, phaseOf } from '@/lib/salon/event-marketing'
import type { DayReport, ReportMarketingByEvent, TemplateReport } from '@/lib/salon/events-report'
import { eventMoneyShare } from '@/lib/salon/money-share'
import {
  PRIVATE_BLOCK_LINK,
  privateEditionsNote,
  privateOnlyTemplateState,
  type WithPrivateGroups,
} from '@/lib/salon/private-groups'
import { legendFlags } from '@/lib/salon/tables-wall'
import { cn } from '@/lib/utils'
import { BirthdaysMonthView } from './birthdays-month-view'
import { EditionsStrip } from './editions-strip'
import { EventConsolidated } from './event-consolidated'
import { MarketingMonthView } from './marketing-month-view'
import { MoneyShareDonut } from './money-share-donut'
import { NightCard } from './night-card'
import { TablesWallLegend } from './tables-wall'

export type TemplateOption = {
  id: string
  name: string
  colorHex: string | null
  /** Fechas en el calendario, incluidas las que vienen. */
  editions: number
  /** Fechas que ya terminaron: las únicas que cuentan como historia. */
  pastEditions: number
  /** Personas sentadas en las fechas que ya terminaron. */
  guests: number
  upcoming: number
}

export type ComoNosFueView = 'dia' | 'evento' | 'pauta' | 'cumples'

/** El último dólar cargado en cualquier pauta del bar: el chip del formulario. */
export type LastUsdArsRate = { rate: number; loadedAt: string } | null

/** Lo que manda la page: el reporte de siempre + la pauta por `scheduled_event_id`. */
type DayReportWithMarketing = DayReport & { marketing: ReportMarketingByEvent }
type TemplateReportWithMarketing = TemplateReport & { marketing: ReportMarketingByEvent }

const nf = new Intl.NumberFormat('es-AR')

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + delta))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

function longDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(dt)
}

function shortDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
  const weekday = new Intl.DateTimeFormat('es-AR', { weekday: 'short', timeZone: 'UTC' })
    .format(dt)
    .replace('.', '')
  return `${weekday} ${String(dt.getUTCDate()).padStart(2, '0')}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}`
}

/** "Hoy" / "Ayer" / "Anteayer" / "Mañana", o nada. Ubica sin hacer cuentas. */
function relativeLabel(day: string, today: string): string | null {
  if (day === today) return 'Hoy'
  if (day === shiftDay(today, -1)) return 'Ayer'
  if (day === shiftDay(today, -2)) return 'Anteayer'
  if (day === shiftDay(today, 1)) return 'Mañana'
  return day > today ? 'Todavía no pasó' : null
}

export function ComoNosFueDashboard({
  tenantSlug,
  view,
  day,
  today,
  ym,
  recentDays,
  dayReport,
  templates,
  templatesTruncated,
  templateId,
  templateReport,
  monthReport,
  birthdayReport,
  lastUsdArsRate,
}: {
  tenantSlug: string
  view: ComoNosFueView
  day: string
  today: string
  /** `YYYY-MM` de la pestaña «Pauta». Validado por la page. */
  ym: string
  recentDays: Array<{ day: string; reservations: number }>
  dayReport: DayReportWithMarketing | null
  templates: TemplateOption[]
  templatesTruncated: boolean
  templateId: string | null
  templateReport: TemplateReportWithMarketing | null
  /** Solo en la pestaña «Pauta». Con sus grupos privados, que no son ediciones. */
  monthReport: WithPrivateGroups<MonthMarketingReport> | null
  /** Solo en la pestaña «Cumpleaños». */
  birthdayReport: MonthBirthdayReport | null
  lastUsdArsRate: LastUsdArsRate
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  /** Mergea, no reemplaza: ir y volver entre vistas no pierde la selección. */
  function push(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(next)) params.set(k, v)
    startTransition(() => {
      router.push(`?${params.toString()}`, { scroll: false })
    })
  }

  // La planilla sale con el MISMO corte que está en pantalla: el día elegido, el
  // evento elegido o el mes elegido. Nunca de los searchParams crudos, que
  // pueden no traer el default que la page resolvió.
  const exportBase = `/api/como-nos-fue/export?slug=${encodeURIComponent(tenantSlug)}`
  const exportHref: string | null =
    view === 'dia'
      ? `${exportBase}&vista=dia&dia=${day}`
      : view === 'pauta'
        ? `${exportBase}&vista=pauta&mes=${monthReport?.ym ?? ym}`
        : view === 'cumples'
          ? `${exportBase}&vista=cumples&mes=${birthdayReport?.ym ?? ym}`
          : null

  const relativo = relativeLabel(day, today)
  // Las banderas de la leyenda salen de las MISMAS mesas que se dibujan.
  // `NightCard` esconde el muro cuando el bloque no tiene reservas en pie, y en
  // la vista por evento solo dibuja muro el hero: sin este acuerdo, la leyenda
  // llegaba a mostrar "se cayó" con las canceladas de una edición colapsada que
  // no tiene un solo chip en pantalla. Lo mismo vale para "silla vacía" y
  // "se sumó alguien": solo si hay una en pantalla. La pestaña «Pauta» no
  // dibuja ningún muro, así que tampoco lleva leyenda.
  // «Por evento» ya no dibuja ningún muro (C3: sin «Última fecha»), así que
  // solo «Por día» lleva leyenda.
  const chipsEnPantalla =
    view === 'dia'
      ? (dayReport?.blocks.filter((b) => b.reservations > 0).flatMap((b) => b.tables) ?? [])
      : []
  const legend = legendFlags(chipsEnPantalla)
  const hayMuro = legend.counted || legend.open

  return (
    <div className={cn('space-y-5', pending && 'opacity-60 transition-opacity')}>
      {/* Interruptor de vista + planilla */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SlidingTabs
          size="sm"
          value={view}
          onChange={(v) => push({ vista: v })}
          tabs={[
            { value: 'dia', label: 'Por día' },
            { value: 'evento', label: 'Por evento' },
            { value: 'pauta', label: 'Pauta' },
            { value: 'cumples', label: 'Cumpleaños' },
          ]}
        />
        {/* En «Por evento» cada cuadro trae su propio «Exportar» (C4): la planilla
            mezclada de antes ya no existe. */}
        {view === 'evento' ? null : (
          <Button asChild variant="outline" size="sm" className="gap-2">
            <a href={exportHref ?? undefined} download title="Descargar planilla (Excel / Sheets)">
              <Download className="size-4" />
              <span className="sr-only sm:not-sr-only">Exportar</span>
            </a>
          </Button>
        )}
      </div>

      {view === 'dia' ? (
        <>
          {/* Selector de día. Las flechas se mueven de a un día real: una noche
              sin nadie ES el dato, no un hueco a saltear. El salto largo vive
              en el calendario, con la lista de las últimas noches con gente. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="Día anterior"
              onClick={() => push({ dia: shiftDay(day, -1) })}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <div className="min-w-0">
              {relativo ? (
                <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {relativo}
                </div>
              ) : null}
              <h2 className="truncate font-serif text-xl font-semibold capitalize leading-tight tracking-tight sm:text-2xl">
                {longDay(day)}
              </h2>
            </div>
            <Button
              variant="outline"
              size="icon"
              aria-label="Día siguiente"
              onClick={() => push({ dia: shiftDay(day, 1) })}
            >
              <ChevronRight className="size-4" />
            </Button>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5">
                  <CalendarDays className="size-4" />
                  <span className="sr-only sm:not-sr-only">Elegir</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 space-y-3">
                <Input
                  type="date"
                  value={day}
                  aria-label="Elegir fecha"
                  onChange={(e) => {
                    if (e.target.value) push({ dia: e.target.value })
                  }}
                  className="h-10"
                />
                {recentDays.length > 0 ? (
                  <div className="space-y-1">
                    <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Últimas noches con gente
                    </p>
                    <ul className="max-h-56 space-y-0.5 overflow-y-auto">
                      {recentDays.map((d) => (
                        <li key={d.day}>
                          <button
                            type="button"
                            onClick={() => push({ dia: d.day })}
                            className={cn(
                              'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-secondary/60',
                              d.day === day && 'bg-secondary/70 font-medium',
                            )}
                          >
                            <span className="capitalize">{shortDay(d.day)}</span>
                            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                              {d.reservations}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </PopoverContent>
            </Popover>
          </div>

          {dayReport ? (
            <DayView
              report={dayReport}
              tenantSlug={tenantSlug}
              today={today}
              lastUsdArsRate={lastUsdArsRate}
            />
          ) : null}
        </>
      ) : view === 'cumples' ? (
        birthdayReport ? (
          <BirthdaysMonthView tenantSlug={tenantSlug} report={birthdayReport} onNavigate={push} />
        ) : null
      ) : view === 'pauta' ? (
        monthReport ? (
          <MarketingMonthView
            tenantSlug={tenantSlug}
            today={today}
            report={monthReport}
            lastUsdArsRate={lastUsdArsRate}
            onNavigate={push}
          />
        ) : null
      ) : (
        <>
          <Select
            value={templateId ?? undefined}
            onValueChange={(v) => push({ vista: 'evento', evento: v })}
          >
            <SelectTrigger className="h-11 w-full sm:w-96">
              <SelectValue placeholder="Elegí un evento" />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  <span className="flex w-full items-center gap-2">
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: t.colorHex ?? 'var(--muted-foreground)' }}
                    />
                    <span className="truncate">{t.name}</span>
                    <span className="ml-auto shrink-0 pl-3 font-mono text-[11px] tabular-nums text-muted-foreground">
                      {t.pastEditions === 0
                        ? t.editions === 0
                          ? 'sin fechas'
                          : 'todavía no se hizo'
                        : `${t.pastEditions} ${t.pastEditions === 1 ? 'fecha' : 'fechas'} · ${nf.format(t.guests)} personas`}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {templateReport ? (
            <EventView report={templateReport} tenantSlug={tenantSlug} />
          ) : (
            <EmptyState
              icon={PartyPopper}
              title="Elegí un evento"
              description="Vas a ver todas sus fechas, una debajo de la otra, para saber si crece o se apaga."
            />
          )}
        </>
      )}

      {hayMuro && view !== 'pauta' && view !== 'cumples' ? (
        <TablesWallLegend flags={legend} />
      ) : null}

      {dayReport?.truncated ||
      templateReport?.truncated ||
      templatesTruncated ||
      monthReport?.truncated ||
      birthdayReport?.truncated ? (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-text">
          Hay más reservas de las que entran en una sola lectura: los números pueden estar
          incompletos.
        </p>
      ) : null}
    </div>
  )
}

function DayView({
  report,
  tenantSlug,
  today,
  lastUsdArsRate,
}: {
  report: DayReportWithMarketing
  tenantSlug: string
  today: string
  lastUsdArsRate: LastUsdArsRate
}) {
  const eventos = report.blocks.filter((b) => b.kind === 'event')
  // Grupos privados (C1, 02/10): su gente es de la noche, pero no son eventos.
  // Van en su franja, después de los eventos y antes de «Sin evento» (el
  // agregador ya dejó afuera los que no tuvieron a nadie).
  const privados = report.blocks.filter((b) => b.kind === 'private')
  const plain = report.blocks.find((b) => b.kind === 'plain')
  const futura = report.day > today
  // Todas las fichas de evento de la noche comparten fecha, así que comparten
  // fase: "Por ahora" hoy y a futuro, historia de ayer para atrás.
  const phase = phaseOf(report.day, today)

  // Una noche que se cayó entera NO es una noche vacía: que dos reservas se
  // hayan cancelado es justamente lo que el dueño viene a ver. Sin este chequeo,
  // el estado vacío se comía la nota de las caídas.
  const huboCaidas = report.blocks.some((b) => b.cancelled + b.noShow > 0)
  if (report.totals.reservations === 0 && eventos.length === 0 && !huboCaidas) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="Esa noche no hubo ninguna reserva"
        description="Ni de evento ni normales. Probá con otra fecha: en el calendario están las últimas noches con gente."
      />
    )
  }

  // "Sin evento" se promueve a protagonista cuando la noche no tuvo evento NI
  // grupo privado: es todo lo que pasó, no una nota al pie.
  const plainTone = eventos.length === 0 && privados.length === 0 ? 'event' : 'plain'
  const totalNoche = report.totals.guests
  const share = (guests: number) =>
    guests > 0 && guests < totalNoche ? `${guests} de las ${totalNoche} de la noche` : undefined

  return (
    <div className="space-y-4">
      {futura ? (
        <p className="text-xs text-warning-text">
          Todavía no pasó: estos números se siguen moviendo hasta esa noche.
        </p>
      ) : null}

      {eventos.length > 0 ? (
        <div className={cn('grid gap-4', eventos.length > 1 && 'lg:grid-cols-2')}>
          {eventos.map((b) => (
            <NightCard
              key={b.key}
              block={b}
              tone="event"
              eventHref={
                b.templateId
                  ? `/${tenantSlug}/estadisticas/como-nos-fue?vista=evento&evento=${b.templateId}`
                  : undefined
              }
              dayShare={share(b.guests)}
              // La pauta cuelga de la edición: sin `eventId` no hay dónde
              // guardarla, así que tampoco hay sección.
              marketing={
                b.eventId
                  ? {
                      tenantSlug,
                      eventDate: report.day,
                      phase,
                      row: report.marketing[b.eventId] ?? null,
                      lastUsdArsRate,
                    }
                  : undefined
              }
            />
          ))}
        </div>
      ) : null}

      {/* Un grupo privado no lleva pauta ni cuenta, ni link a «Por evento»: no
          es un evento. Su link lleva a la fecha del calendario, que es donde se
          cambia el tilde. */}
      {privados.map((b) => (
        <NightCard
          key={b.key}
          block={b}
          tone="plain"
          eventHref={b.eventId ? `/${tenantSlug}/eventos/programados/${b.eventId}` : undefined}
          linkLabel={PRIVATE_BLOCK_LINK}
          dayShare={share(b.guests)}
        />
      ))}

      {/* "Sin evento" nunca lleva pauta, ni siquiera cuando se promueve a
          protagonista: no hay una fecha de evento a la que atarla. */}
      {plain ? (
        <NightCard
          block={plain}
          tone={plainTone}
          // Solo cuando la noche se reparte de verdad: "12 de las 12 de la
          // noche" es una tautología, y pasa las 9 noches en que el evento
          // programado no vendió nada.
          dayShare={share(plain.guests)}
          emptyText={
            eventos.some((e) => e.reservations > 0) && !privados.some((p) => p.reservations > 0)
              ? 'No hubo reservas fuera del evento: toda la noche fue del evento.'
              : 'No hubo ninguna reserva normal esa noche.'
          }
        />
      ) : null}
    </div>
  )
}

export function EventView({
  report,
  tenantSlug,
}: {
  report: TemplateReportWithMarketing
  tenantSlug: string
}) {
  if (report.editions.length === 0 && report.privateEditions > 0) {
    // Un formato que solo tuvo grupos privados (el selector ya no lo ofrece;
    // se llega por link): «todavía no le pusiste fecha» sería falso.
    const state = privateOnlyTemplateState(report.templateName, report.privateEditions)
    return <EmptyState icon={Lock} title={state.title} description={state.description} />
  }
  if (report.editions.length === 0) {
    return (
      <EmptyState
        icon={PartyPopper}
        title={`Todavía no le pusiste fecha a ${report.templateName}`}
        description="Cuando lo programes en el calendario, acá vas a ver cómo le fue."
        action={
          <Button asChild variant="outline" size="sm">
            <a href={`/${tenantSlug}/eventos/programados`}>Ir al calendario</a>
          </Button>
        }
      />
    )
  }

  // Lo que todavía no terminó incluye la fecha de HOY: la tira la lista, así que
  // el texto que la cuenta tiene que contarla igual.
  const porVenir = report.editions.filter((e) => e.isFuture || e.isTonight)
  const vendiendo = porVenir.find((e) => e.reservations > 0)
  // Sin «Última fecha» (C3): arriba van directo los dos cuadros. Esta oración
  // queda solo cuando todavía no hay historia que mostrar (ninguna fecha que
  // terminó con reservas), que es justo cuando los cuadros no la cuentan.
  const sinHistoria =
    report.latest !== null
      ? null
      : vendiendo
        ? `Todavía no terminó ninguna fecha de ${report.templateName} con reservas. ${
            vendiendo.isTonight ? 'La de esta noche va' : 'La que viene ya tiene'
          } ${nf.format(vendiendo.guests)} ${vendiendo.guests === 1 ? 'persona' : 'personas'} en ${vendiendo.reservations} ${vendiendo.reservations === 1 ? 'reserva' : 'reservas'}.`
        : report.hasPastEditions
          ? `Ninguna fecha de ${report.templateName} tuvo reservas todavía.`
          : `${report.templateName} todavía no se hizo nunca: ${
              porVenir.length === 1
                ? porVenir[0]?.isTonight
                  ? 'la de esta noche está'
                  : 'la fecha que viene está'
                : `las ${porVenir.length} fechas que vienen están`
            } más abajo.`

  const consolidated = buildEventConsolidated({
    templateName: report.templateName,
    editions: report.editions,
    marketing: report.marketing,
  })
  // La dona (C5): las mismas fechas que el ✓ / ✗ de «Rentabilidad». `null` sin
  // ninguna con la cuenta cerrada, y entonces no se dibuja nada en su lugar.
  const share = eventMoneyShare({ editions: report.editions, marketing: report.marketing })
  const exportInput = {
    tenantSlug,
    templateId: report.templateId,
    templateName: report.templateName,
  }
  const privateNote = privateEditionsNote(report.privateEditions)

  return (
    <div className="space-y-4">
      {sinHistoria ? <p className="text-sm text-muted-foreground">{sinHistoria}</p> : null}

      {/* Los dos cuadros, lado a lado desde que el bloque mide 64rem (container
          query: plegar la barra lateral cambia el ancho sin cambiar la
          pantalla). A la izquierda «Rentabilidad» y debajo su dona; a la
          derecha «Conversión». Más angosto van apilados en ese mismo orden. */}
      <div className="@container">
        <div
          className={cn(
            'grid items-start gap-4',
            consolidated && '@5xl:grid-cols-[32rem_minmax(0,1fr)] @5xl:gap-5',
          )}
        >
          {consolidated ? (
            <div className="grid min-w-0 gap-4">
              <EventConsolidated
                key={report.templateId}
                data={consolidated}
                tenantSlug={tenantSlug}
                exportAction={cuadroExport('rentabilidad', exportInput)}
              />
              {share ? <MoneyShareDonut data={share} /> : null}
            </div>
          ) : null}
          <EditionsStrip
            report={report}
            marketing={report.marketing}
            tenantSlug={tenantSlug}
            exportAction={cuadroExport('conversion', exportInput)}
          />
        </div>
      </div>

      {/* Una sola vez, debajo de los dos cuadros: las fechas privadas del
          formato no son ediciones (C1). Las dos planillas la repiten al final. */}
      {privateNote ? <p className="text-xs text-muted-foreground">{privateNote}</p> : null}
    </div>
  )
}
