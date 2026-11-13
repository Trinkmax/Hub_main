'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { AdmHeader, AdmPage } from '@/components/administracion/kit/adm-page'
import { MoneyHero } from '@/components/administracion/kit/hero'
import { Panel } from '@/components/administracion/kit/panel'
import { PillLink } from '@/components/administracion/kit/pill'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { METHOD_ICON } from '@/components/pos/cash/method'
import { formatCentsShort } from '@/lib/money'
import { METHOD_LABEL } from '@/lib/pos/cash/types'
import { clockAt } from '@/lib/pos/order/clock'
import {
  branchLabel,
  shiftDay,
  shiftWords,
  summarizeToday,
  todaySentence,
} from '@/lib/pos/today/summary'
import type {
  SalesPeriod,
  TodayBranch,
  TodayData,
  TodayShift,
  TodaySummary,
} from '@/lib/pos/today/types'
import { useVisibleInterval } from '@/lib/realtime/use-visible-interval'
import { cn } from '@/lib/utils'
import { Storefront } from '../../sucursales/_components/storefront'

/** Cada cuánto se vuelve a leer mientras la pantalla está a la vista. */
const REFRESH_MS = 30_000

const money = (cents: number) => formatCentsShort(cents)
const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`)

/** «viernes 13 de noviembre». Un día `AAAA-MM-DD` no tiene hora: se lee en UTC para no correrlo. */
function dayWords(day: string): string {
  const date = new Date(`${day}T12:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return day
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(date)
}

const capital = (text: string) => text.charAt(0).toLocaleUpperCase('es') + text.slice(1)

/**
 * «Hoy en vivo»: cómo va el día en el salón, para mirar desde el celular. El número grande es lo que
 * se vendió (lo mismo que ve la caja); debajo, por dónde entró, cuánto gasta cada persona, lo que
 * sigue abierto y lo que conviene mirar (descuentos, bajas, cobros corregidos, cajas que no cuadraron).
 *
 * Con más de una sucursal se ven todas juntas o de a una. Mientras es hoy, se actualiza sola.
 */
export function TodayBoard({
  tenantSlug,
  data,
  recent,
  branchSlug,
  today,
  timeZone,
}: {
  tenantSlug: string
  data: TodayData
  /** Los últimos días, para ver este en contexto. `null` = no se pudo leer. */
  recent: SalesPeriod | null
  /** `?sucursal=`: una sola. Sin dato, todas. */
  branchSlug: string | null
  /** El día de servicio en curso. */
  today: string
  timeZone: string
}) {
  const router = useRouter()
  useVisibleInterval(() => {
    if (data.isToday) router.refresh()
  }, REFRESH_MS)

  const branch = data.branches.find((item) => item.slug === branchSlug) ?? null
  const summary = summarizeToday(data, branch?.id ?? null)
  const many = data.branches.length > 1
  const base = `/${tenantSlug}/local/hoy`
  const href = (next: { day?: string; branch?: string | null }) => {
    const day = next.day ?? data.day
    const slug = next.branch === undefined ? (branch?.slug ?? null) : next.branch
    const query = new URLSearchParams()
    if (day !== today) query.set('dia', day)
    if (slug) query.set('sucursal', slug)
    const text = query.toString()
    return text ? `${base}?${text}` : base
  }
  const shifts = (
    branch ? data.shifts.filter((shift) => shift.branchId === branch.id) : data.shifts
  )
    .slice()
    .sort((a, b) => a.openedAt.localeCompare(b.openedAt))
  const nameOf = (branchId: string) =>
    branchLabel(data.branches.find((item) => item.id === branchId) ?? { name: '', shortName: null })
  const empty = summary.payments === 0 && summary.tables === 0 && summary.openTables === 0

  return (
    <AdmPage width="comfortable">
      <AdmHeader
        title={data.isToday ? 'Hoy en vivo' : capital(dayWords(data.day))}
        description={
          data.isToday
            ? `${capital(dayWords(data.day))}. Lo que se vendió en el salón, cobro por cobro. Se actualiza solo.`
            : 'Cómo quedó ese día: lo que se vendió en el salón, cobro por cobro.'
        }
        actions={
          <>
            <PillLink
              href={href({ day: shiftDay(data.day, -1) })}
              icon={ChevronLeft}
              scroll={false}
            >
              Día anterior
            </PillLink>
            {data.isToday ? null : (
              <>
                {shiftDay(data.day, 1) < today ? (
                  <PillLink href={href({ day: shiftDay(data.day, 1) })} scroll={false}>
                    Día siguiente
                  </PillLink>
                ) : null}
                <PillLink href={href({ day: today })} icon={ChevronRight} scroll={false}>
                  Hoy
                </PillLink>
              </>
            )}
          </>
        }
      />

      {many ? (
        <nav aria-label="Sucursal" className="flex flex-wrap gap-2">
          <PillLink href={href({ branch: null })} active={branch === null} scroll={false}>
            Todas
          </PillLink>
          {data.branches.map((item) => (
            <PillLink
              key={item.id}
              href={href({ branch: item.slug })}
              active={branch?.id === item.id}
              scroll={false}
            >
              {branchLabel(item)}
            </PillLink>
          ))}
        </nav>
      ) : null}

      <section aria-label="Lo que se vendió" data-testid="hoy-venta">
        <MoneyHero
          cents={summary.salesCents}
          label={branch ? `Vendido en ${branch.name}` : 'Vendido en el salón'}
          sentence={todaySentence(summary, { isToday: data.isToday, money })}
          size="xl"
        />
        {data.isToday ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Leído a las {clockAt(new Date(data.loadedAt).toISOString(), timeZone)}
          </p>
        ) : null}
      </section>

      {many && branch === null ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.branches.map((item) => (
            <BranchCard
              key={item.id}
              branch={item}
              summary={summarizeToday(data, item.id)}
              isToday={data.isToday}
              href={href({ branch: item.slug })}
            />
          ))}
        </ul>
      ) : null}

      {empty ? (
        <Panel>
          <p className="text-sm text-muted-foreground text-pretty">
            {data.isToday
              ? 'Cuando el salón abra la primera mesa, acá empieza a verse cómo va el día.'
              : 'Ese día el salón no cargó nada en el punto de venta.'}
          </p>
        </Panel>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          <Panel
            title="Por dónde entró"
            description={
              summary.tipCents > 0 || summary.surchargeCents > 0
                ? `Con ${[
                    summary.surchargeCents > 0
                      ? `${money(summary.surchargeCents)} de recargo de crédito`
                      : null,
                    summary.tipCents > 0 ? `${money(summary.tipCents)} de propinas` : null,
                  ]
                    .filter(Boolean)
                    .join(' y ')}, entraron ${money(summary.collectedCents)} en total.`
                : undefined
            }
          >
            {summary.byMethod.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavía no hay cobros.</p>
            ) : (
              <ul className="space-y-3" data-testid="hoy-medios">
                {summary.byMethod.map((entry) => {
                  const Icon = METHOD_ICON[entry.method]
                  return (
                    <li key={entry.method}>
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="flex items-center gap-2 font-medium">
                          <Icon aria-hidden className="size-4 text-muted-foreground" />
                          {METHOD_LABEL[entry.method]}
                          <span className="font-normal text-muted-foreground">
                            {count(entry.count, 'cobro', 'cobros')}
                          </span>
                        </span>
                        <span className="tabular-nums">
                          <span className="font-semibold">{money(entry.cents)}</span>
                          <span className="ml-2 text-muted-foreground">{entry.share} %</span>
                        </span>
                      </div>
                      <div
                        aria-hidden
                        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
                      >
                        <div
                          className="h-full rounded-full bg-foreground/70"
                          style={{ width: `${Math.max(entry.share, 2)}%` }}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            {summary.payments > 0 ? (
              <p className="mt-4 border-t border-border/60 pt-3 text-sm text-muted-foreground text-pretty">
                Con factura:{' '}
                <b className="font-semibold text-foreground">{money(summary.invoicedCents)}</b>. Sin
                factura:{' '}
                <b className="font-semibold text-foreground">{money(summary.notInvoicedCents)}</b>.
              </p>
            ) : null}
          </Panel>

          <Panel title="El salón">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-5">
              <Figure
                label="Por persona"
                value={summary.perPersonCents === null ? '—' : money(summary.perPersonCents)}
                note={
                  summary.people > 0
                    ? `${count(summary.people, 'persona', 'personas')} en ${count(summary.tables, 'mesa cobrada', 'mesas cobradas')}`
                    : 'Sin personas anotadas'
                }
                testId="hoy-per-capita"
              />
              <Figure
                label="Mesas abiertas"
                value={data.isToday ? String(summary.openTables) : '—'}
                note={
                  !data.isToday
                    ? 'Solo se ve en el día'
                    : summary.openTables === 0
                      ? 'El salón está vacío'
                      : `${money(summary.openCents)} por cobrar${summary.waitingBill > 0 ? ` · ${count(summary.waitingBill, 'pidió la cuenta', 'pidieron la cuenta')}` : ''}`
                }
              />
              <Figure
                label="Mesas con socio"
                value={String(summary.memberTables)}
                note={
                  summary.pointsAwarded > 0
                    ? `Sumaron ${count(summary.pointsAwarded, 'punto', 'puntos')}`
                    : 'Sin puntos sumados'
                }
              />
              <Figure
                label="Señas descontadas"
                value={money(summary.depositCents)}
                note="Plata que no pasó por la caja hoy"
              />
            </dl>
          </Panel>

          <Panel
            title="Para mirar"
            description="Lo que conviene revisar: no son errores, es lo que alguien decidió a mano."
          >
            <ul className="divide-y divide-border/60" data-testid="hoy-para-mirar">
              <Watch
                label="Descuentos"
                value={summary.discountCents > 0 ? money(summary.discountCents) : 'Ninguno'}
                note={
                  summary.discountedTables > 0
                    ? `En ${count(summary.discountedTables, 'mesa', 'mesas')}`
                    : null
                }
                flag={summary.discountCents > 0}
              />
              <Watch
                label="Productos dados de baja"
                value={summary.voidedLines > 0 ? money(summary.voidedCents) : 'Ninguno'}
                note={
                  summary.voidedLines > 0
                    ? count(summary.voidedLines, 'renglón', 'renglones')
                    : null
                }
                flag={summary.voidedLines > 0}
              />
              <Watch
                label="Cobros anulados"
                value={summary.voidedPayments > 0 ? String(summary.voidedPayments) : 'Ninguno'}
                note={null}
                flag={summary.voidedPayments > 0}
              />
              <Watch
                label="Cobros corregidos"
                value={
                  summary.correctedPayments > 0 ? String(summary.correctedPayments) : 'Ninguno'
                }
                note={
                  summary.correctedPayments > 0
                    ? 'Se cambió el medio, la factura o el recargo'
                    : null
                }
                flag={summary.correctedPayments > 0}
              />
              <Watch
                label="Cajas que no cuadraron"
                value={
                  summary.shiftsOff > 0
                    ? formatCentsShort(summary.shiftDifferenceCents, { sign: 'always' })
                    : summary.closedShifts > 0
                      ? 'Todas cuadraron'
                      : 'Todavía no cerró ninguna'
                }
                note={summary.shiftsOff > 0 ? count(summary.shiftsOff, 'turno', 'turnos') : null}
                flag={summary.shiftsOff > 0}
              />
            </ul>
          </Panel>

          <Panel title="Lo que más salió" description="Por cantidad, sin lo que se dio de baja.">
            {summary.topProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavía no salió nada.</p>
            ) : (
              <ol className="divide-y divide-border/60" data-testid="hoy-productos">
                {summary.topProducts.map((product, index) => (
                  <li
                    key={product.menuItemId}
                    className="flex items-baseline gap-3 py-2 text-sm first:pt-0 last:pb-0"
                  >
                    <span className="w-5 shrink-0 text-right tabular-nums text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{product.name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {product.quantity} · {money(product.cents)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <Panel
            title="Turnos de caja"
            className="lg:col-span-2"
            description="El detalle de cada uno (la cinta, los retiros, el arqueo) está en Caja."
          >
            {shifts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {data.isToday
                  ? 'Todavía no se abrió ninguna caja.'
                  : 'Ese día no hubo turnos de caja.'}
              </p>
            ) : (
              <ul className="divide-y divide-border/60" data-testid="hoy-turnos">
                {shifts.map((shift) => (
                  <ShiftRow
                    key={shift.id}
                    shift={shift}
                    branchName={many ? nameOf(shift.branchId) : null}
                    timeZone={timeZone}
                    href={`/${tenantSlug}/salon/caja?sucursal=${encodeURIComponent(data.branches.find((item) => item.id === shift.branchId)?.slug ?? '')}`}
                  />
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}

      {recent && recent.days.length > 0 ? (
        <RecentDays
          recent={recent}
          current={data.day}
          today={today}
          hrefOf={(day) => href({ day })}
        />
      ) : null}
    </AdmPage>
  )
}

/** Los últimos días como una tira de barras: cada una lleva a su día. */
function RecentDays({
  recent,
  current,
  today,
  hrefOf,
}: {
  recent: SalesPeriod
  current: string
  today: string
  hrefOf: (day: string) => string
}) {
  const top = Math.max(1, ...recent.days.map((day) => day.salesCents))
  const weekday = (day: string) =>
    new Intl.DateTimeFormat('es-AR', { weekday: 'narrow', timeZone: 'UTC' }).format(
      new Date(`${day}T12:00:00.000Z`),
    )
  return (
    <Panel
      title={`Los últimos ${recent.days.length} días`}
      description={
        recent.activeDays === 0
          ? 'Todavía no hay ventas en estos días.'
          : `${money(recent.salesCents)} en ${count(recent.activeDays, 'día con ventas', 'días con ventas')}${recent.averageCents === null ? '' : `: ${money(recent.averageCents)} por día`}${recent.perPersonCents === null ? '' : ` y ${money(recent.perPersonCents)} por persona`}.${recent.best ? ` El mejor fue el ${dayWords(recent.best.day)}, con ${money(recent.best.salesCents)}.` : ''}`
      }
    >
      <ol className="flex h-40 items-end gap-1 sm:gap-1.5" data-testid="hoy-ultimos-dias">
        {recent.days.map((day) => {
          const selected = day.day === current
          const height =
            day.salesCents > 0 ? Math.max(6, Math.round((day.salesCents / top) * 100)) : 0
          return (
            <li key={day.day} className="flex h-full min-w-0 flex-1 flex-col justify-end">
              <Link
                href={hrefOf(day.day)}
                scroll={false}
                aria-current={selected ? 'date' : undefined}
                aria-label={`${capital(dayWords(day.day))}: ${day.salesCents > 0 ? money(day.salesCents) : 'sin ventas'}`}
                title={`${capital(dayWords(day.day))}: ${day.salesCents > 0 ? money(day.salesCents) : 'sin ventas'}`}
                className="group flex h-full flex-col justify-end gap-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  aria-hidden
                  className={cn(
                    'block w-full rounded-t-sm transition-colors duration-(--duration-fast)',
                    height === 0 && 'h-px bg-border',
                    height > 0 &&
                      (selected
                        ? 'bg-foreground'
                        : 'bg-foreground/35 group-hover:bg-foreground/60'),
                  )}
                  style={height > 0 ? { height: `${height}%` } : undefined}
                />
                <span
                  aria-hidden
                  className={cn(
                    'text-center text-[11px] uppercase leading-none tabular-nums',
                    selected ? 'font-semibold text-foreground' : 'text-muted-foreground',
                    day.day === today && 'underline underline-offset-2',
                  )}
                >
                  {weekday(day.day)}
                </span>
              </Link>
            </li>
          )
        })}
      </ol>
    </Panel>
  )
}

function BranchCard({
  branch,
  summary,
  isToday,
  href,
}: {
  branch: TodayBranch
  summary: TodaySummary
  isToday: boolean
  href: string
}) {
  return (
    <li>
      <Link
        href={href}
        scroll={false}
        data-testid={`hoy-sucursal-${branch.slug}`}
        className="card-hairline flex items-center gap-4 rounded-2xl border bg-card p-4 shadow-xs outline-none transition-colors duration-(--duration-fast) hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/40"
      >
        <Storefront
          size="mini"
          label={branchLabel(branch)}
          color={branch.color}
          open={summary.openShifts > 0 ? 1 : 0}
          className="w-16 shrink-0"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{branch.name}</p>
          <p className="font-serif text-2xl font-semibold leading-tight tracking-tight tabular-nums">
            {money(summary.salesCents)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
            {shiftWords(summary, isToday)}
            {isToday && summary.openTables > 0
              ? ` · ${count(summary.openTables, 'mesa abierta', 'mesas abiertas')}`
              : ''}
          </p>
        </div>
      </Link>
    </li>
  )
}

function Figure({
  label,
  value,
  note,
  testId,
}: {
  label: string
  value: string
  note: string
  testId?: string
}) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd
        className="mt-0.5 font-serif text-2xl font-semibold leading-tight tracking-tight tabular-nums"
        data-testid={testId}
      >
        {value}
      </dd>
      <dd className="mt-0.5 text-xs text-muted-foreground text-pretty">{note}</dd>
    </div>
  )
}

function Watch({
  label,
  value,
  note,
  flag,
}: {
  label: string
  value: string
  note: string | null
  /** Hay algo para mirar: va resaltado. */
  flag: boolean
}) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
      <span className="min-w-0">
        <span className="font-medium">{label}</span>
        {note ? <span className="ml-2 text-xs text-muted-foreground">{note}</span> : null}
      </span>
      <span
        className={cn(
          'shrink-0 tabular-nums',
          flag ? 'font-semibold text-warning-text' : 'text-muted-foreground',
        )}
      >
        {value}
      </span>
    </li>
  )
}

function ShiftRow({
  shift,
  branchName,
  timeZone,
  href,
}: {
  shift: TodayShift
  branchName: string | null
  timeZone: string
  href: string
}): ReactNode {
  const diff = shift.differenceCents ?? 0
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-3 text-sm first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="font-medium">
          {shift.label ?? 'Turno'}
          {branchName ? (
            <span className="ml-2 font-normal text-muted-foreground">{branchName}</span>
          ) : null}
        </p>
        <p className="text-xs text-muted-foreground text-pretty">
          Abrió {shift.openedByName} a las {clockAt(shift.openedAt, timeZone)}
          {shift.status === 'closed' && shift.closedAt
            ? ` · cerró ${shift.closedByName ?? ''} a las ${clockAt(shift.closedAt, timeZone)}`
            : ''}
        </p>
      </div>
      <div className="flex items-center gap-3">
        {shift.status === 'open' ? (
          <StatusPill tone="info">Abierto</StatusPill>
        ) : diff === 0 ? (
          <StatusPill tone="ok">Cuadró</StatusPill>
        ) : (
          <StatusPill tone="warn">
            {diff > 0 ? 'Sobraron' : 'Faltaron'} {formatCentsShort(Math.abs(diff))}
          </StatusPill>
        )}
        <Link
          href={href}
          className="rounded-md text-sm font-medium underline underline-offset-4 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          Ver en Caja
        </Link>
      </div>
    </li>
  )
}
