'use client'

import Link from 'next/link'
import {
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { toast } from 'sonner'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import {
  Planilla,
  PlanillaFoot,
  PRow,
  PTable,
  PTd,
  PTh,
  PTotalRow,
  ROW_ACTION,
} from '@/components/administracion/planilla'
import { Totalizer } from '@/components/administracion/planilla/totalizer'
import { toastUndo } from '@/components/administracion/quick-actions'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import { saveSalesTargets } from '@/lib/accounting/actions/projection'
import { DAY_TYPE_LABELS, DAY_TYPE_LEGEND, type DayType, dayTypes } from '@/lib/accounting/day-type'
import type { MonthDayState } from '@/lib/accounting/home'
import { isPastedColumn } from '@/lib/accounting/paste'
import {
  buildProjection,
  cashDiffText,
  copyMonthTargets,
  type ProjectionDay,
  type ProjectionSourceDay,
  type TargetOfDay,
} from '@/lib/accounting/projection'
import type {
  CashCountTreasury,
  DailyCashCounts,
  DayEvents,
} from '@/lib/accounting/queries/projection'
import { MAX_CENTS } from '@/lib/accounting/schemas'
import { capitalizeFirst, formatDayMonth, monthName } from '@/lib/dates'
import { formatCentsShort, NBSP } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  cashCheckText,
  cashPending,
  cashTitle,
  changedTargets,
  closeHref,
  compliancePercent,
  dayCell,
  dayExtra,
  liveTargets,
  longDay,
  nextCloseDay,
  type PendingTargets,
  planillaHref,
  planillaTotals,
  rowAction,
  savedTarget,
} from '../_lib/planilla'
import { parseTargetsList } from '../_lib/targets-import'
import { detailParam, type VentasFocus } from '../_lib/ventas-view'
import { CashCountDialog } from './cash-count-dialog'
import { NoteCell } from './day-cells'
import { LinkPending } from './link-pending'
import { MoneyCell, type MoneyCellCommit } from './money-cell'
import { TargetsImportDialog } from './targets-import-dialog'

type TargetItem = TargetOfDay

const omit = <T,>(record: Readonly<Record<string, T>>, keys: readonly string[]) => {
  if (!keys.some((key) => key in record)) return record
  const next = { ...record }
  for (const key of keys) delete next[key]
  return next
}

/**
 * Guarda en tanda: lo que se escribe mientras hay un guardado en camino sale todo junto en el
 * siguiente. Cargar un mes con Enter son treinta celdas: treinta viajes a la base, con la página
 * entera recalculándose treinta veces, no van. Cada envío es la acción de siempre, y su respuesta
 * ya trae la página al día.
 */
function useTargetsQueue(
  tenantSlug: string,
  onFailure: (items: TargetItem[], message: string) => void,
) {
  const queue = useRef(new Map<string, number | null>())
  const running = useRef(false)
  const failure = useRef(onFailure)
  useEffect(() => {
    failure.current = onFailure
  })

  return useCallback(
    (items: readonly TargetItem[]) => {
      for (const item of items) queue.current.set(item.day, item.targetCents)
      if (running.current) return
      running.current = true
      void (async () => {
        try {
          while (queue.current.size > 0) {
            const batch = [...queue.current].map(([day, targetCents]) => ({ day, targetCents }))
            queue.current.clear()
            try {
              const result = await saveSalesTargets(tenantSlug, { items: batch })
              if (!result.ok) failure.current(batch, result.message)
            } catch {
              failure.current(batch, ACC_UNREACHABLE.offline)
            }
          }
        } finally {
          running.current = false
        }
      })()
    },
    [tenantSlug],
  )
}

function Dash() {
  return <span className="text-muted-foreground/60">—</span>
}

function Money({ cents, show = true }: { cents: number; show?: boolean }) {
  return show && cents !== 0 ? formatCentsShort(cents) : <Dash />
}

function TypeTag({ type }: { type: DayType }) {
  if (type === 'none') {
    return <span className="text-xs text-muted-foreground">{DAY_TYPE_LABELS.none}</span>
  }
  return <StatusPill tone={type === 'strong' ? 'ok' : 'muted'}>{DAY_TYPE_LABELS[type]}</StatusPill>
}

/** La columna del día queda fija al deslizar el detalle: no se pierde de qué noche es. */
const STICKY_HEAD =
  'sticky left-0 z-[2] bg-[color-mix(in_oklab,var(--color-secondary)_50%,var(--color-card))]'
const STICKY_CELL = 'sticky left-0 z-[1] bg-card'
const NOTE_LINK =
  'font-medium text-foreground underline-offset-4 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'

export type MonthPlanillaProps = {
  /** `yyyy-MM`. */
  month: string
  /** Lo que trajo la base, un renglón por día: de acá sale todo lo que no se escribe. */
  rows: readonly ProjectionSourceDay[]
  serviceDay: string
  /** `monthDays`: cargado, falta, hoy, viene o antes del arranque de los libros. */
  states: Readonly<Record<string, MonthDayState>>
  /** Eventos del calendario por día; `null` si quien mira no los puede leer. */
  events: DayEvents | null
  /** Lo que entró por caja y la lista de cajas: solo para quien carga. */
  counts: DailyCashCounts
  treasuries: readonly CashCountTreasury[]
  /** El mes pasado y sus objetivos, para copiarlos. `null`: quien mira no copia. */
  previous: { month: string; targets: readonly TargetOfDay[] } | null
  /** `/<bar>/administracion`. */
  base: string
  /** El `?mes=` de la URL, si hay: se conserva en los links. */
  monthParam: string | null
  focus: VentasFocus | null
  /** Con qué abre «Ver detalle» (`parseDetail`). */
  initialDetail: boolean
  /** Desde cuándo se llevan las cuentas, si el mes empezó antes: los cierres arrancan ahí. */
  closesFrom: string | null
  canWrite: boolean
  /** Lo que el servidor manda aparte: qué medios no tienen la comisión cargada. */
  commissionNote?: ReactNode
}

/**
 * La planilla del mes (reunión del 29/10/2026): la proyección que estaba en el Excel, día por día.
 * Se escribe el objetivo de cada día y el tipo sale solo. Es el revés de lo que había antes, donde se
 * elegía el total del mes y qué días eran fuertes, y se prorrateaba.
 *
 * Todo lo que depende del objetivo (el tipo, el cumplimiento, los acumulados y los tres números de
 * arriba) se recalcula mientras se escribe, con la misma cuenta que usa el servidor
 * (`buildProjection`). «Ver detalle» suma las columnas que pidieron los socios el 12/10 y las de
 * ventas contra caja, y es solo de pantalla: no le pide nada al servidor.
 *
 * Quien solo mira ve los mismos números, sin celdas que se escriban ni nada que cargue.
 */
export function MonthPlanilla({
  month,
  rows,
  serviceDay,
  states,
  events,
  counts,
  treasuries,
  previous,
  base,
  monthParam,
  focus,
  initialDetail,
  closesFrom,
  canWrite,
  commissionNote,
}: MonthPlanillaProps) {
  const { tenantSlug } = useAccounting()
  const [detail, setDetail] = useState(initialDetail)
  // Lo que se está escribiendo: manda sobre lo guardado hasta salir de la celda.
  const [typed, setTyped] = useState<Readonly<Record<string, number | null>>>({})
  const [optimistic, setOptimistic] = useState<PendingTargets>({})
  const [cellErrors, setCellErrors] = useState<Readonly<Record<string, string>>>({})
  const [confirmCopy, setConfirmCopy] = useState(false)
  const inputs = useRef(new Map<string, HTMLInputElement>())
  const cashHead = useRef<HTMLSpanElement>(null)

  const serverTarget = useMemo(() => new Map(rows.map((r) => [r.day, r.targetCents])), [rows])
  const savedOf = (day: string): number | null =>
    savedTarget(serverTarget.get(day) ?? null, optimistic[day])

  const projection = useMemo(
    () => buildProjection(liveTargets(rows, typed, optimistic), { serviceDay }),
    [rows, serviceDay, typed, optimistic],
  )
  const types = useMemo(() => dayTypes(projection.days), [projection.days])

  // Cuando la página ya trajo otro dato, lo recién guardado no se usa más: se saca, para que un valor
  // viejo no vuelva a aparecer si después el objetivo vuelve al número de antes (por «Pegar una lista»).
  useEffect(() => {
    setOptimistic((prev) =>
      omit(
        prev,
        Object.keys(prev).filter((day) => prev[day]?.from !== (serverTarget.get(day) ?? null)),
      ),
    )
  }, [serverTarget])

  const undoOptimistic = useCallback((items: readonly TargetItem[]) => {
    setOptimistic((prev) =>
      omit(
        prev,
        items.map((item) => item.day),
      ),
    )
  }, [])

  const enqueue = useTargetsQueue(tenantSlug, (items, message) => {
    undoOptimistic(items)
    toast.error(message, {
      action: { label: 'Reintentar', onClick: () => save(items) },
    })
  })

  function save(items: readonly TargetItem[]) {
    setOptimistic((prev) => {
      const next = { ...prev }
      for (const item of items) {
        next[item.day] = { from: serverTarget.get(item.day) ?? null, value: item.targetCents }
      }
      return next
    })
    enqueue(items)
  }

  /** Guarda varios días de una vez, con «Deshacer»: pegar una columna y copiar el mes pasado. */
  function saveBatch(items: readonly TargetItem[], label: string) {
    const changes = changedTargets(items, savedOf)
    if (changes.length === 0) {
      toast('Ya estaba así: no cambió nada.')
      return
    }
    const before = changes.map((item) => ({ day: item.day, targetCents: savedOf(item.day) }))
    const days = changes.map((item) => item.day)
    setTyped((prev) => omit(prev, days))
    setCellErrors((prev) => omit(prev, days))
    save(changes)
    toastUndo(`${label} · ${changes.length === 1 ? '1 día' : `${changes.length} días`}`, {
      onUndo: () => save(before),
    })
  }

  function commitCell(day: string, result: MoneyCellCommit) {
    // Lo que no se entiende queda escrito y en rojo: ni se guarda ni se tira.
    if (!result.ok) return
    setTyped((prev) => omit(prev, [day]))
    const next = result.cents === 0 ? null : result.cents
    if (next !== savedOf(day)) save([{ day, targetCents: next }])
  }

  function focusRow(index: number) {
    const target = projection.days[index]
    if (target) inputs.current.get(target.day)?.focus()
  }

  function onCellKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key === 'Enter' || event.key === 'ArrowDown') {
      event.preventDefault()
      focusRow(index + 1)
      // En el último día no hay a dónde bajar: Enter igual guarda.
      if (index === projection.days.length - 1) event.currentTarget.blur()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusRow(index - 1)
    }
  }

  /** Pegar una columna de Excel en una celda la reparte hacia abajo, desde ese día. */
  function onCellPaste(event: ClipboardEvent<HTMLInputElement>, day: string) {
    const text = event.clipboardData.getData('text')
    if (!isPastedColumn(text)) return
    event.preventDefault()
    const parsed = parseTargetsList(text, month, { fromDay: Number(day.slice(8, 10)) })
    if (parsed.items.length > 0) saveBatch(parsed.items, 'Objetivos pegados')
    if (parsed.invalid.length > 0) {
      toast.warning(
        `No se entiende el monto del renglón ${parsed.invalid[0]?.line}: ese día quedó como estaba.`,
      )
    }
    if (parsed.overflow > 0) {
      toast.warning(
        parsed.overflow === 1
          ? 'Sobró 1 renglón: el mes no tiene tantos días.'
          : `Sobraron ${parsed.overflow} renglones: el mes no tiene tantos días.`,
      )
    }
  }

  const fromMonthName = previous ? monthName(Number(previous.month.slice(5, 7))) : ''
  const copyItems = useMemo(
    () =>
      previous
        ? copyMonthTargets({ month, fromMonth: previous.month, targets: previous.targets })
        : [],
    [month, previous],
  )
  const canCopy = canWrite && copyItems.length > 0
  const copyLabel = `Copiar ${fromMonthName}`
  const copy = () => saveBatch(copyItems, `Objetivos de ${fromMonthName} copiados`)
  const overwritten = changedTargets(copyItems, savedOf).filter(
    (item) => savedOf(item.day) !== null,
  ).length

  function toggleDetail(next: boolean) {
    setDetail(next)
    // Sin ir al servidor: los datos ya están acá. La URL lo recuerda al recargar y al cambiar de mes.
    const url = new URL(window.location.href)
    const param = detailParam(next, focus)
    if (param) url.searchParams.set('detalle', param)
    else url.searchParams.delete('detalle')
    window.history.replaceState(null, '', url)
  }

  // Se entró por «Ventas contra caja»: esas columnas tienen que quedar a la vista.
  useEffect(() => {
    if (focus === 'caja') cashHead.current?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [focus])

  const { days, totals, summary, cash } = projection
  const hasCloses = days.some((d) => d.hasClose)
  const { hasTargets } = summary
  const name = capitalizeFirst(monthName(Number(month.slice(5, 7))))
  const nextClose = nextCloseDay(days, states)
  // Una sola acción llena por pantalla: en un mes sin objetivos es la de copiar.
  const closePrimary = hasTargets || !canCopy
  const link = {
    base,
    tab: focus,
    month: monthParam,
    detail: detailParam(detail, focus),
  }
  const firstError = days.find((d) => cellErrors[d.day])
  const pending = cashPending(cash)

  const action = (d: ProjectionDay): ReactNode => {
    const kind = rowAction(states[d.day], canWrite)
    if (kind === 'view') {
      return (
        <Button
          asChild
          size="sm"
          variant="outline"
          className={cn('relative h-7 pointer-coarse:h-10', ROW_ACTION)}
        >
          {/* Sin prefetch: un mes son 31 renglones y no queremos 31 pedidos al entrar. */}
          <Link href={planillaHref(link, d.day)} prefetch={false} replace scroll={false}>
            Ver cierre
            <span className="sr-only"> del {longDay(d.day)}</span>
            <LinkPending />
          </Link>
        </Button>
      )
    }
    if (kind === 'load') {
      return (
        <Button
          asChild
          size="sm"
          variant={closePrimary && d.day === nextClose ? 'default' : 'outline'}
          className="h-7 pointer-coarse:h-10"
        >
          <Link href={closeHref(base, d.day)} prefetch={false}>
            Cargar cierre
            <span className="sr-only"> del {longDay(d.day)}</span>
          </Link>
        </Button>
      )
    }
    return states[d.day] === 'missing' ? (
      <span className="text-xs text-muted-foreground">Sin cierre</span>
    ) : null
  }

  const entered = (d: ProjectionDay): ReactNode => {
    if (d.moment === 'future') return <Dash />
    if (!canWrite) {
      return d.cashCountedCents === null ? (
        <span className="text-xs text-muted-foreground">Sin cargar</span>
      ) : (
        formatCentsShort(d.cashCountedCents)
      )
    }
    const initial = counts[d.day] ?? {}
    return (
      <CashCountDialog
        day={d.day}
        dayLabel={longDay(d.day)}
        treasuries={treasuries.filter((t) => t.active || initial[t.id] !== undefined)}
        initial={initial}
        salesCents={d.hasClose ? d.realCents : null}
        countedCents={d.cashCountedCents}
      />
    )
  }

  const difference = (d: ProjectionDay): ReactNode => {
    const words = cashCheckText(d.cash)
    if (words === null) return <Dash />
    if (d.cash.kind !== 'compared') {
      return <span className="text-xs text-muted-foreground">{words}</span>
    }
    return (
      <span
        className={cn(
          'font-medium',
          d.cash.diffCents === 0
            ? 'text-success'
            : d.cash.diffCents < 0
              ? 'text-destructive'
              : undefined,
        )}
      >
        {words}
      </span>
    )
  }

  return (
    <>
      <Totalizer items={planillaTotals(summary, { hasCloses })} />

      <Planilla>
        {!hasTargets ? (
          // Vacío: una oración y un botón, adentro de la misma planilla.
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-3 py-2.5">
            <p className="min-w-0 text-sm text-pretty">
              {name} todavía no tiene objetivos.
              {canWrite
                ? canCopy
                  ? ` Copiá los de ${fromMonthName} y ajustá lo que cambie, o escribilos día por día.`
                  : ' Escribilos día por día o pegá la columna de tu Excel.'
                : null}
            </p>
            {canCopy ? (
              <Button type="button" size="sm" className="pointer-coarse:h-10" onClick={copy}>
                {copyLabel}
              </Button>
            ) : canWrite ? (
              <TargetsImportDialog
                month={month}
                monthLabel={name}
                variant="primary"
                className="pointer-coarse:h-10"
              />
            ) : null}
          </div>
        ) : null}

        <PTable minWidth={detail ? 1720 : 560} label={`Proyección de ${name}`}>
          <thead>
            <tr>
              <PTh className={detail ? STICKY_HEAD : undefined}>Día</PTh>
              <PTh>Tipo</PTh>
              <PTh align="right">Objetivo</PTh>
              <PTh align="right">
                <span title="Venta neta: sin las comisiones estimadas">Vendido</span>
              </PTh>
              <PTh align="right">Cumpl.</PTh>
              <PTh>
                <span className="sr-only">Cierre</span>
              </PTh>
              {detail ? (
                <>
                  <PTh align="right">Venta bar</PTh>
                  <PTh align="right">Delivery</PTh>
                  <PTh align="right">Comisión delivery</PTh>
                  <PTh align="right">Comisiones posnet</PTh>
                  <PTh align="right">Venta real</PTh>
                  <PTh align="right">Venta neta</PTh>
                  <PTh align="right">Objetivo acumulado</PTh>
                  <PTh align="right">Venta acumulada</PTh>
                  <PTh align="right">
                    <span ref={cashHead}>Entró a caja</span>
                  </PTh>
                  <PTh align="right">Diferencia</PTh>
                  <PTh>Evento y nota</PTh>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {days.map((d, index) => {
              const today = d.moment === 'today'
              const dayEvents = events?.[d.day] ?? []
              const extra = dayExtra(dayEvents, d.note)
              const percent = compliancePercent(d.compliance)
              return (
                <PRow key={d.day}>
                  <PTd
                    className={cn(
                      'whitespace-nowrap',
                      detail && STICKY_CELL,
                      // Hoy lleva la raya a la izquierda. Va en la celda: en un `tr` no todos la dibujan.
                      today && 'font-semibold shadow-[inset_3px_0_0_var(--color-primary)]',
                    )}
                  >
                    {dayCell(d.day)}
                    {today ? <span className="sr-only"> (hoy)</span> : null}
                    {extra ? (
                      <small className="block max-w-40 truncate text-xs font-normal text-muted-foreground">
                        {extra}
                      </small>
                    ) : null}
                  </PTd>
                  <PTd>
                    <TypeTag type={types[d.day] ?? 'none'} />
                  </PTd>
                  <PTd align="right">
                    {canWrite ? (
                      <MoneyCell
                        // Lo escrito tal cual: un cero es «sin objetivo» recién al salir de la celda.
                        value={d.day in typed ? (typed[d.day] ?? null) : d.targetCents}
                        maxCents={MAX_CENTS}
                        aria-label={`Objetivo del ${longDay(d.day)}`}
                        inputRef={(node) => {
                          if (node) inputs.current.set(d.day, node)
                          else inputs.current.delete(d.day)
                        }}
                        onValueChange={(cents) =>
                          setTyped((prev) =>
                            prev[d.day] === cents && d.day in prev
                              ? prev
                              : { ...prev, [d.day]: cents },
                          )
                        }
                        onCommit={(result) => commitCell(d.day, result)}
                        onErrorChange={(error) =>
                          setCellErrors((prev) =>
                            error === null
                              ? omit(prev, [d.day])
                              : prev[d.day] === error
                                ? prev
                                : { ...prev, [d.day]: error },
                          )
                        }
                        onKeyDown={(event) => onCellKeyDown(event, index)}
                        onPaste={(event) => onCellPaste(event, d.day)}
                      />
                    ) : (
                      <Money cents={d.targetCents ?? 0} />
                    )}
                  </PTd>
                  <PTd align="right" className="font-medium">
                    <Money cents={d.netCents} show={d.hasClose} />
                  </PTd>
                  <PTd align="right">
                    {percent ? (
                      <span
                        className={cn(
                          'font-medium',
                          percent.good ? 'text-success' : 'text-destructive',
                        )}
                      >
                        {percent.text}
                      </span>
                    ) : (
                      <Dash />
                    )}
                  </PTd>
                  <PTd className="w-[7.5rem] whitespace-nowrap text-right">{action(d)}</PTd>
                  {detail ? (
                    <>
                      <PTd align="right">
                        <Money cents={d.barCents} show={d.hasClose} />
                      </PTd>
                      <PTd align="right">
                        <Money cents={d.deliveryCents} show={d.hasClose} />
                      </PTd>
                      <PTd align="right">
                        <Money cents={d.deliveryCommissionCents} show={d.hasClose} />
                      </PTd>
                      <PTd align="right">
                        <Money cents={d.posnetCommissionCents} show={d.hasClose} />
                      </PTd>
                      <PTd align="right">
                        <Money cents={d.realCents} show={d.hasClose} />
                      </PTd>
                      <PTd align="right">
                        <Money cents={d.netCents} show={d.hasClose} />
                      </PTd>
                      <PTd align="right">
                        <Money cents={d.targetAccumCents} />
                      </PTd>
                      <PTd align="right">
                        <Money cents={d.netAccumCents} show={d.moment !== 'future'} />
                      </PTd>
                      <PTd align="right">{entered(d)}</PTd>
                      <PTd align="right">{difference(d)}</PTd>
                      <PTd className="min-w-48">
                        {dayEvents.length > 0 ? (
                          <span className="block text-pretty">{dayEvents.join(' · ')}</span>
                        ) : null}
                        {canWrite ? (
                          <NoteCell day={d.day} dayLabel={longDay(d.day)} note={d.note} />
                        ) : d.note ? (
                          <span className="block text-pretty">{d.note}</span>
                        ) : null}
                      </PTd>
                    </>
                  ) : null}
                </PRow>
              )
            })}
          </tbody>
          <tfoot>
            <PTotalRow>
              <PTd colSpan={2} className={detail ? 'sticky! left-0 z-[1]' : undefined}>
                Total
              </PTd>
              <PTd align="right">
                <Money cents={totals.targetCents} />
              </PTd>
              <PTd align="right">
                <Money cents={totals.netCents} show={hasCloses} />
              </PTd>
              <PTd align="right">
                {summary.monthPercent !== null && hasCloses ? (
                  `${summary.monthPercent}${NBSP}%`
                ) : (
                  <Dash />
                )}
              </PTd>
              <PTd />
              {detail ? (
                <>
                  <PTd align="right">
                    <Money cents={totals.barCents} />
                  </PTd>
                  <PTd align="right">
                    <Money cents={totals.deliveryCents} />
                  </PTd>
                  <PTd align="right">
                    <Money cents={totals.deliveryCommissionCents} />
                  </PTd>
                  <PTd align="right">
                    <Money cents={totals.posnetCommissionCents} />
                  </PTd>
                  <PTd align="right">
                    <Money cents={totals.realCents} />
                  </PTd>
                  <PTd align="right">
                    <Money cents={totals.netCents} />
                  </PTd>
                  <PTd colSpan={2} />
                  <PTd align="right">
                    <Money cents={cash.countedCents} show={cash.comparedDays > 0} />
                  </PTd>
                  <PTd align="right">
                    {cash.comparedDays > 0 ? cashDiffText(cash.diffCents) : <Dash />}
                  </PTd>
                  <PTd />
                </>
              ) : null}
            </PTotalRow>
          </tfoot>
        </PTable>

        {firstError ? (
          <p role="alert" className="border-t border-border/70 px-3 py-2 text-sm text-destructive">
            Objetivo del {longDay(firstError.day)}: {cellErrors[firstError.day]}
          </p>
        ) : null}

        <PlanillaFoot>
          <span className="min-w-0 text-xs text-muted-foreground text-pretty">
            {DAY_TYPE_LEGEND}
            {closesFrom ? ` Los cierres arrancan el ${formatDayMonth(closesFrom)}.` : null}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {canWrite ? (
              <TargetsImportDialog
                month={month}
                monthLabel={name}
                className="pointer-coarse:h-10"
              />
            ) : null}
            {canCopy ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="pointer-coarse:h-10"
                onClick={() => (overwritten > 0 ? setConfirmCopy(true) : copy())}
              >
                {copyLabel}
              </Button>
            ) : null}
            <div className="flex min-h-8 items-center gap-2 pl-1 pointer-coarse:min-h-10">
              <Switch
                id="ventas-ver-detalle"
                checked={detail}
                onCheckedChange={toggleDetail}
                size="sm"
              />
              <Label htmlFor="ventas-ver-detalle" className="cursor-pointer whitespace-nowrap">
                Ver detalle
              </Label>
            </div>
          </div>
        </PlanillaFoot>

        {detail ? (
          <div className="space-y-1.5 border-t border-border/70 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground text-pretty">
            <p>
              Vendido es la venta neta, sin las comisiones estimadas con los porcentajes de{' '}
              {canWrite ? (
                <Link href={`${base}/ajustes?tab=participes`} className={NOTE_LINK}>
                  Ajustes
                </Link>
              ) : (
                'Ajustes'
              )}
              . Lo que descontaron de verdad está en «Lo que llegó».
              {totals.eventsCents > 0
                ? ' La venta bar incluye lo vendido por el canal Eventos.'
                : ''}
            </p>
            {commissionNote}
            <p>
              <span className="font-medium text-foreground">Ventas contra caja:</span>{' '}
              {cashTitle(cash, { reader: !canWrite })}. Compara la venta real con la plata que entró
              cada día; las apps no cuentan, pagan después. No cambia ningún saldo: el efectivo
              contado va en el cierre del día, y ahí sí corrige la caja.
              {pending.length > 0 ? ` ${pending.join(' ')}` : ''}
            </p>
          </div>
        ) : null}
      </Planilla>

      <AlertDialog open={confirmCopy} onOpenChange={setConfirmCopy}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Reemplazás lo que ya cargaste?</AlertDialogTitle>
            <AlertDialogDescription>
              {overwritten === 1
                ? `1 día de ${name.toLowerCase()} ya tiene otro objetivo y se reemplaza por el de ${fromMonthName}.`
                : `${overwritten} días de ${name.toLowerCase()} ya tienen otro objetivo y se reemplazan por los de ${fromMonthName}.`}{' '}
              Después podés deshacerlo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 md:h-9">Dejar lo mío</AlertDialogCancel>
            <AlertDialogAction className="h-11 md:h-9" onClick={copy}>
              Reemplazar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
