'use client'

import { CalendarDays, Lock, PartyPopper } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useOptimistic, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { ExportButton } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { PeriodPicker, type PeriodPickerPreset } from '@/components/ui/period-picker'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  capitalizeFirst,
  formatWeekdayDayMonth,
  MONTH_NAMES,
  WEEKDAY_NAMES,
} from '@/lib/dates/format'
import { formatNumber } from '@/lib/format/number-kind'
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

const VIEWS: ReadonlyArray<{ value: ComoNosFueView; label: string }> = [
  { value: 'dia', label: 'Por día' },
  { value: 'evento', label: 'Por evento' },
  { value: 'pauta', label: 'Pauta' },
  { value: 'cumples', label: 'Cumpleaños' },
]

function isView(value: string): value is ComoNosFueView {
  return VIEWS.some((v) => v.value === value)
}

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + delta))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

/**
 * `'2026-10-03'` → `'Viernes 3 de octubre'`, armado a mano: el `Intl` del
 * server y el del navegador no siempre coinciden y rompían la hidratación.
 */
function longDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
  const weekday = WEEKDAY_NAMES[dt.getUTCDay()] ?? ''
  const month = MONTH_NAMES[dt.getUTCMonth()] ?? ''
  return capitalizeFirst(`${weekday} ${dt.getUTCDate()} de ${month}`)
}

/** "Hoy" / "Ayer" / "Anteayer" / "Mañana", o nada. Ubica sin hacer cuentas. */
function relativeLabel(day: string, today: string): string | null {
  if (day === today) return 'Hoy'
  if (day === shiftDay(today, -1)) return 'Ayer'
  if (day === shiftDay(today, -2)) return 'Anteayer'
  if (day === shiftDay(today, 1)) return 'Mañana'
  return day > today ? 'Todavía no pasó' : null
}

/**
 * Los atajos del selector de día: las últimas noches con gente, con cuántas
 * reservas tuvo cada una (lo que antes era la lista del calendario). Sin noches
 * con gente, los atajos de siempre del kit (Hoy · Ayer).
 */
function recentDayPresets(
  recentDays: ReadonlyArray<{ day: string; reservations: number }>,
): PeriodPickerPreset[] | undefined {
  if (recentDays.length === 0) return undefined
  return recentDays.map((d) => ({
    label: `${capitalizeFirst(formatWeekdayDayMonth(d.day))} · ${formatNumber(d.reservations)} ${d.reservations === 1 ? 'reserva' : 'reservas'}`,
    period: { kind: 'day', date: d.day },
  }))
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
  // La pestaña elegida se marca al toque (optimista) mientras el server trae la
  // vista nueva; si la navegación falla, vuelve a la de la URL.
  const [shownView, setShownView] = useOptimistic(view)

  /**
   * Mergea, no reemplaza: ir y volver entre vistas no pierde la selección.
   * `replace` para las pestañas (no dejan una entrada por cada una en el
   * historial). Los días y el evento siguen con push.
   */
  function push(
    next: Record<string, string>,
    mode: 'push' | 'replace' = 'push',
    optimistic?: () => void,
  ) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(next)) params.set(k, v)
    const href = `?${params.toString()}`
    startTransition(() => {
      optimistic?.()
      if (mode === 'replace') router.replace(href, { scroll: false })
      else router.push(href, { scroll: false })
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
    <div
      aria-busy={pending || undefined}
      className={cn('space-y-5', pending && 'opacity-60 transition-opacity')}
    >
      {/* Las cuatro vistas son secciones de la misma página: pestañas del kit.
          Cada una la arma el server (`?vista=`), así que van en modo manual
          (las flechas mueven el foco; Enter o Espacio eligen y navegan). */}
      <Tabs
        value={shownView}
        onValueChange={(next) => {
          if (isView(next)) push({ vista: next }, 'replace', () => setShownView(next))
        }}
        activationMode="manual"
      >
        <div className="flex items-end justify-between gap-3">
          <TabsList aria-label="Vistas de Cómo nos fue" className="flex-1">
            {VIEWS.map((v) => (
              <TabsTrigger key={v.value} value={v.value}>
                {v.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {/* En «Por evento» cada cuadro trae su propio «Exportar» (C4): la
              planilla mezclada de antes ya no existe. */}
          {exportHref ? (
            <ExportButton
              href={exportHref}
              size="sm"
              title="Descargar planilla (Excel / Sheets)"
              className="mb-1 shrink-0"
            />
          ) : null}
        </div>

        <TabsContent value={shownView} className="space-y-5 pt-3">
          {view === 'dia' ? (
            <>
              {/* Selector de día (el `PeriodPicker` del kit). Las flechas se
                  mueven de a un día real: una noche sin nadie ES el dato, no un
                  hueco a saltear. El salto largo vive en el calendario, con las
                  últimas noches con gente como atajos. */}
              <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
                <div className="min-w-0">
                  {relativo ? (
                    <div className="type-small text-muted-foreground">{relativo}</div>
                  ) : null}
                  <h2 className="truncate type-section">{longDay(day)}</h2>
                </div>
                <PeriodPicker
                  aria-label="Día"
                  kinds={['day']}
                  value={{ kind: 'day', date: day }}
                  presets={recentDayPresets(recentDays)}
                  today={today}
                  onValueChange={(next) => {
                    if (next.kind === 'day') push({ dia: next.date })
                  }}
                />
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
              <BirthdaysMonthView
                tenantSlug={tenantSlug}
                report={birthdayReport}
                onNavigate={push}
              />
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
                <SelectTrigger aria-label="Evento" className="w-full sm:w-96">
                  <SelectValue placeholder="Elegí un evento" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem
                      key={t.id}
                      value={t.id}
                      description={
                        t.pastEditions === 0
                          ? t.editions === 0
                            ? 'sin fechas'
                            : 'todavía no se hizo'
                          : `${t.pastEditions} ${t.pastEditions === 1 ? 'fecha' : 'fechas'} · ${formatNumber(t.guests)} personas`
                      }
                    >
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: t.colorHex ?? 'var(--muted-foreground)' }}
                      />
                      <span className="truncate">{t.name}</span>
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
            <Callout tone="warning">
              Hay más reservas de las que entran en una sola lectura: los números pueden estar
              incompletos.
            </Callout>
          ) : null}
        </TabsContent>
      </Tabs>
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
        <Callout tone="warning">
          Todavía no pasó: estos números se siguen moviendo hasta esa noche.
        </Callout>
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
          <Button asChild variant="secondary" size="sm">
            <Link href={`/${tenantSlug}/eventos/programados`}>Ir al calendario</Link>
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
          } ${formatNumber(vendiendo.guests)} ${vendiendo.guests === 1 ? 'persona' : 'personas'} en ${vendiendo.reservations} ${vendiendo.reservations === 1 ? 'reserva' : 'reservas'}.`
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
      {sinHistoria ? (
        <p className="max-w-prose text-pretty type-body text-muted-foreground">{sinHistoria}</p>
      ) : null}

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
      {privateNote ? <p className="type-caption text-muted-foreground">{privateNote}</p> : null}
    </div>
  )
}
