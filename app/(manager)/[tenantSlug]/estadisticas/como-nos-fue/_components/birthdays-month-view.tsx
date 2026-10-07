'use client'

import { Cake, Megaphone, Pencil } from 'lucide-react'
import { useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Disclosure } from '@/components/ui/disclosure'
import { PeriodPicker } from '@/components/ui/period-picker'
import {
  type BirthdayDay,
  type BirthdayMarketingRow,
  type BirthdayTile,
  birthdayLoadedByLabel,
  birthdayPautaReport,
  type MonthBirthdayReport,
} from '@/lib/salon/birthdays-report'
import { cn } from '@/lib/utils'
import { BirthdayMarketingForm } from './birthday-marketing-form'

/**
 * La pestaña «Cumpleaños»: cuántos cumples tuvo el mes, día por día, con
 * cuánta gente, y qué cerró la pauta de cumpleaños del mes.
 *
 * Se lee de arriba abajo como un informe: la oración del mes, los tres números
 * grandes (cumpleaños, personas, promedio), el calendario y la pauta. Todas las
 * cuentas y los textos salen de `lib/salon/birthdays-report.ts`.
 *
 * La pauta guardada se muestra al instante (`local`) y la reemplaza la que trae
 * el refresh apenas llega: mismo patrón que la ficha de la pauta de eventos,
 * atado a la versión de props para no parpadear entre las dos.
 *
 * El mes se elige con el `PeriodPicker` del kit (flechas de mes anterior y
 * siguiente, y la grilla de meses), el mismo de «Pauta».
 */

const WEEKDAY_HEADERS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'] as const
const WEEKDAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

/** Las tarjetas de la pestaña: cartulina, pelo y radio del kit, sin sombra. */
const CARD = 'rounded-xl border border-border bg-card text-card-foreground'

/** Lo que se guardó o borró recién (`row: null` = se borró), atado a la versión de props que había. */
type LocalRow = { row: BirthdayMarketingRow | null; propsAt: string | null }

export function BirthdaysMonthView({
  tenantSlug,
  report,
  onNavigate,
}: {
  tenantSlug: string
  report: MonthBirthdayReport
  onNavigate: (next: Record<string, string>) => void
}) {
  const { ym } = report
  const propsAt = report.marketing?.updatedAt ?? null
  const [local, setLocal] = useState<LocalRow | null>(null)
  const row = local && local.propsAt === propsAt ? local.row : report.marketing
  const [editing, setEditing] = useState(false)
  const actionRef = useRef<HTMLButtonElement>(null)

  // Si la fila local es otra que la de props, la cuenta se rehace en el
  // cliente con la MISMA función que la armó en el server.
  const pauta =
    row === report.marketing
      ? report.pauta
      : row
        ? birthdayPautaReport(
            report.booked,
            { adSpendUsd: row.adSpendUsdCents / 100, messages: row.messages, reach: row.reach },
            report.phase,
          )
        : null

  const closeForm = () => {
    setEditing(false)
    requestAnimationFrame(() => actionRef.current?.focus())
  }

  const chip =
    row === null
      ? null
      : report.phase !== 'past'
        ? { text: 'Por ahora', tone: 'muted' as const }
        : row.messages === null
          ? { text: 'Incompleta', tone: 'warning' as const }
          : null

  return (
    <div className="space-y-6">
      {/* Mes: el título de la pestaña es para el lector (a la vista ya lo dice
          el selector). */}
      <h2 className="sr-only">Cumpleaños de {report.monthLabel}</h2>
      <PeriodPicker
        aria-label="Mes"
        kinds={['month']}
        value={{ kind: 'month', month: ym }}
        onValueChange={(next) => {
          if (next.kind === 'month') onNavigate({ vista: 'cumples', mes: next.month })
        }}
      />

      {/* Los números del mes */}
      <section aria-label="Cumpleaños del mes" className={cn(CARD, '@container p-4 sm:p-5')}>
        <p className="max-w-prose text-base leading-snug font-medium text-pretty">
          {report.headline}
        </p>
        <Tiles tiles={report.tiles} className="mt-4" size="lg" />
        {report.notes.length > 0 ? (
          <ul className="mt-4 space-y-1 text-xs leading-relaxed text-muted-foreground">
            {report.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* Calendario */}
      <section aria-labelledby="cumples-calendario" className="space-y-2">
        <h3 id="cumples-calendario" className="type-label text-muted-foreground">
          Día por día
        </h3>
        <Calendar report={report} onDay={(day) => onNavigate({ vista: 'dia', dia: day })} />
        <p className="type-caption text-muted-foreground">
          Cuantos más cumples, más fuerte el color. Borde punteado: todavía no pasó. Tocá un día
          para ver la noche entera.
        </p>
      </section>

      {/* Pauta de cumpleaños */}
      <section className={cn(CARD, '@container p-4 sm:p-5')}>
        {editing ? (
          <BirthdayMarketingForm
            tenantSlug={tenantSlug}
            ym={ym}
            monthName={report.monthName}
            phase={report.phase}
            booked={report.booked}
            row={row}
            onCancel={closeForm}
            onSaved={(saved) => {
              setLocal({ row: saved, propsAt })
              closeForm()
            }}
            onDeleted={() => {
              setLocal({ row: null, propsAt })
              closeForm()
            }}
          />
        ) : row === null || pauta === null ? (
          <>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h3 className="type-label text-muted-foreground">Pauta de cumpleaños</h3>
              <span
                className={cn(
                  'type-caption font-medium',
                  report.phase === 'past' ? 'text-warning-text' : 'text-muted-foreground',
                )}
              >
                Sin cargar
              </span>
            </div>
            <p className="mt-2 max-w-prose text-pretty type-body">{report.bookedLine}</p>
            <p className="mt-1 max-w-prose text-pretty text-xs leading-relaxed text-muted-foreground">
              {report.phase === 'past'
                ? 'Cargá lo que se gastó en la campaña de cumpleaños y los mensajes del mes para ver cuánto cerró.'
                : 'Si la campaña de cumpleaños ya está corriendo, cargala y la vas actualizando.'}
            </p>
            <Button
              ref={actionRef}
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() => setEditing(true)}
            >
              <Megaphone aria-hidden />
              Cargar pauta de cumpleaños
            </Button>
          </>
        ) : (
          <>
            <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <div className="flex items-baseline gap-2">
                <h3 className="type-label text-muted-foreground">Pauta de cumpleaños</h3>
                {chip ? (
                  <Badge tone={chip.tone === 'warning' ? 'warning' : 'neutral'}>{chip.text}</Badge>
                ) : null}
              </div>
              <div className="flex items-center gap-1">
                <span className="type-caption tabular-nums text-muted-foreground">
                  {birthdayLoadedByLabel(row)}
                </span>
                <Button
                  ref={actionRef}
                  variant="ghost"
                  size="sm"
                  className="-mr-2"
                  aria-label={`Editar la pauta de cumpleaños de ${report.monthName}`}
                  onClick={() => setEditing(true)}
                >
                  <Pencil aria-hidden />
                  Editar
                </Button>
              </div>
            </header>

            <p className="mt-2 max-w-prose text-pretty type-body">{pauta.sentence}</p>

            <Tiles tiles={pauta.tiles} className="mt-3" size="md" />

            {pauta.missing ? (
              <p className="mt-3 text-xs text-warning-text">{pauta.missing}</p>
            ) : null}

            {pauta.gap ? (
              <div className="mt-4 rounded-lg bg-secondary/60 p-3 @md:p-4">
                <p className="type-label text-muted-foreground">Lo que falta cerrar</p>
                <p className="mt-1.5 text-base leading-snug font-medium text-pretty">{pauta.gap}</p>
              </div>
            ) : null}

            {pauta.ficha.length > 0 ? (
              <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {pauta.ficha.map((item) => (
                  <div key={item.label} className="flex items-baseline gap-1.5">
                    <dt className="text-muted-foreground">{item.label}</dt>
                    <dd className="font-medium tabular-nums">{item.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}

            <p className="mt-3 max-w-prose text-xs leading-relaxed text-muted-foreground">
              {report.bookedLine}
            </p>

            {row.notes ? (
              <p className="mt-3 whitespace-pre-line break-words border-l-2 border-border pl-3 text-xs text-muted-foreground">
                <span className="sr-only">Nota: </span>
                {row.notes}
              </p>
            ) : null}

            <Disclosure variant="inline" title="¿Cómo se calcula?" className="mt-3">
              <ul className="max-w-prose list-disc space-y-1 pl-4 leading-relaxed text-muted-foreground">
                {report.howItsCalculated.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </Disclosure>
          </>
        )}
      </section>
    </div>
  )
}

/** Números grandes con su cuenta abajo. `null` se dibuja `—` con el motivo. */
function Tiles({
  tiles,
  className,
  size,
}: {
  tiles: BirthdayTile[]
  className?: string
  size: 'lg' | 'md'
}) {
  return (
    <dl
      className={cn(
        'grid gap-y-3',
        tiles.length === 4
          ? 'grid-cols-2 gap-x-4 @xl:grid-cols-4 @xl:divide-x @xl:divide-border'
          : 'grid-cols-3 gap-x-3 divide-x divide-border',
        className,
      )}
    >
      {tiles.map((t) => (
        <div
          key={t.key}
          className={cn(
            'flex min-w-0 flex-col',
            tiles.length === 4
              ? '@xl:px-4 @xl:first:pl-0 @xl:last:pr-0'
              : 'px-3 first:pl-0 last:pr-0',
          )}
        >
          <dd
            className={cn(
              'order-1 font-display leading-none font-[520] tracking-[-0.01em]',
              size === 'lg' ? 'text-3xl sm:text-4xl' : 'text-2xl @xl:text-3xl',
              t.value === null && 'text-muted-foreground',
            )}
          >
            {t.value === null ? (
              <>
                <span className="sr-only">No se puede calcular:</span>
                <span aria-hidden>—</span>
              </>
            ) : (
              t.value
            )}
          </dd>
          <dt className="order-2 mt-2 type-label text-muted-foreground">{t.label}</dt>
          <dd className="order-3 mt-0.5 type-caption text-muted-foreground">{t.hint}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * El mes en una grilla que arranca el lunes. Cada día dice cuántos cumples
 * tuvo (grande) y con cuánta gente (chico, desde `sm`). El color sube con la
 * cantidad, relativo al día más cargado del mes.
 */
function Calendar({
  report,
  onDay,
}: {
  report: MonthBirthdayReport
  onDay: (day: string) => void
}) {
  const max = Math.max(1, report.maxBirthdaysInDay)
  return (
    <div className={cn(CARD, 'p-2 sm:p-3')}>
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5" role="presentation">
        {WEEKDAY_HEADERS.map((w, i) => (
          <div
            key={WEEKDAY_NAMES[i]}
            aria-hidden
            className="pb-1 text-center type-caption font-medium text-muted-foreground"
          >
            {w}
          </div>
        ))}
        {Array.from({ length: report.leadingBlanks }, (_, i) => (
          <div key={`blank-${WEEKDAY_NAMES[i]}`} aria-hidden />
        ))}
        {report.days.map((d) => (
          <DayCell key={d.day} day={d} max={max} onDay={onDay} />
        ))}
      </div>
    </div>
  )
}

function DayCell({
  day,
  max,
  onDay,
}: {
  day: BirthdayDay
  max: number
  onDay: (day: string) => void
}) {
  const has = day.birthdays > 0
  // 12 % el día con 1 cumple, hasta 45 % el día más cargado: con más, el número
  // encima pierde contraste.
  const tint = has ? Math.round(12 + (33 * day.birthdays) / max) : 0
  const label = has
    ? `${day.label}: ${day.birthdays === 1 ? '1 cumpleaños' : `${day.birthdays} cumpleaños`}, ${day.guests === 1 ? '1 persona' : `${day.guests} personas`}${day.phase === 'past' ? '' : ', todavía no pasó'}. Ver la noche.`
    : `${day.label}: sin cumpleaños. Ver la noche.`

  return (
    <button
      type="button"
      onClick={() => onDay(day.day)}
      aria-label={label}
      title={label}
      style={
        has
          ? { backgroundColor: `color-mix(in oklab, var(--primary) ${tint}%, transparent)` }
          : undefined
      }
      className={cn(
        // Sin transición en el hover: se recorre el mes con el mouse. Foco
        // «afuera», del kit.
        'relative flex min-h-14 flex-col items-center justify-center rounded-lg border text-center sm:min-h-20',
        'outline-offset-2 outline-(--ring) hover:border-foreground/30 focus-visible:outline-2',
        has ? 'border-primary/20' : 'border-border bg-muted/20',
        day.phase === 'future' && 'border-dashed',
        day.phase === 'tonight' && 'ring-2 ring-primary',
      )}
    >
      <span
        aria-hidden
        className="absolute left-1.5 top-1 type-caption tabular-nums text-muted-foreground sm:left-2 sm:top-1.5"
      >
        {day.dayOfMonth}
      </span>
      {has ? (
        <>
          <span
            aria-hidden
            className="mt-2 inline-flex items-center gap-1 font-display text-lg leading-none font-[520] sm:text-2xl"
          >
            <Cake className="hidden size-3.5 text-primary sm:inline" />
            {day.birthdays}
          </span>
          <span
            aria-hidden
            className="mt-1 hidden type-caption tabular-nums text-muted-foreground sm:block"
          >
            {day.guests} pers.
          </span>
        </>
      ) : null}
    </button>
  )
}
