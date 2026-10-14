'use client'

import { ArrowRight, ReceiptText } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useState } from 'react'
import { hrefWith } from '@/components/administracion/cajas-ventas/periods'
import {
  EmptyTeach,
  LedgerGroup,
  LedgerList,
  LedgerRail,
  LedgerRow,
  Pill,
} from '@/components/administracion/kit'
import { ActionButton } from '@/components/administracion/quick-actions'
import { Button } from '@/components/ui/button'
import type { TreasuryKind } from '@/lib/accounting/types'
import { monthName, monthOf } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  ACTIVITY_ICONS,
  type ActivityDay,
  type ActivityRow,
  activityAmountLabel,
  activityAmountText,
} from '../../_lib/activity'
import { cajaEmpty } from '../../_lib/wallet-view'

/**
 * Los movimientos como «actividad», día por día: lo que muestra cualquier
 * billetera cuando tocás una tarjeta. Cada renglón dice qué pasó en palabras
 * («Hielo · Gasto»), con el ícono de lo que fue en el margen y la plata a la
 * derecha, con flecha y signo (la dirección no depende del color).
 *
 * `ActivityDays` es la lista (la usan la portada, con todas las cajas, y la
 * ficha de una caja). `CajaActivity` le suma el filtro «Todo · Entró · Salió»
 * de la ficha, que filtra sobre lo ya cargado.
 *
 * La tabla Debe / Haber de siempre sigue estando, en «Ver como tabla».
 */

/** Cómo se dice el saldo al cierre de un día. */
function closingText(mode: 'money' | 'card', cents: number): string {
  const amount = formatCentsShort(Math.abs(cents))
  if (mode === 'card') {
    // En la tarjeta el saldo llega Debe − Haber: la deuda es negativa.
    if (cents < 0) return `Al cierre del día debías ${amount}`
    return cents > 0
      ? `Al cierre del día tenías ${amount} a favor`
      : 'Al cierre del día no debías nada'
  }
  return cents < 0
    ? `Al cierre del día quedó en descubierto por ${amount}`
    : `Al cierre del día quedó en ${amount}`
}

function Amount({ row }: { row: ActivityRow }) {
  return (
    <span
      className={cn('whitespace-nowrap', row.direction === 'neutral' && 'text-muted-foreground')}
    >
      <span aria-hidden>{activityAmountText(row)}</span>
      <span className="sr-only">{activityAmountLabel(row)}</span>
    </span>
  )
}

export function ActivityDays({
  label,
  days,
  base,
  swatches,
  showTreasury = false,
  totals = null,
  className,
}: {
  /** Qué lista es, para lectores: «Últimos movimientos», «Movimientos de Caja». */
  label: string
  days: readonly ActivityDay[]
  /** `/<bar>/administracion`. */
  base: string
  /** El color de cada caja (`bg-*`), por id: el punto del margen. */
  swatches?: Readonly<Record<string, string>>
  /** La portada: cada renglón dice de qué caja es, debajo del importe. */
  showTreasury?: boolean
  /** La ficha de UNA caja: lo que entró y salió cada día, y cómo quedó al cierre. */
  totals?: { mode: 'money' | 'card'; inLabel: string; outLabel: string } | null
  className?: string
}) {
  return (
    <LedgerList bare aria-label={label} className={className}>
      {days.map((day) => (
        <LedgerGroup
          key={day.date}
          title={day.title}
          aside={
            totals && (day.inCents > 0 || day.outCents > 0) ? (
              <span className="inline-flex flex-wrap justify-end gap-x-3">
                {day.inCents > 0 ? (
                  <span className="whitespace-nowrap">
                    <span aria-hidden>↑ </span>
                    {totals.inLabel} {formatCentsShort(day.inCents)}
                  </span>
                ) : null}
                {day.outCents > 0 ? (
                  <span className="whitespace-nowrap">
                    <span aria-hidden>↓ </span>
                    {totals.outLabel} {formatCentsShort(day.outCents)}
                  </span>
                ) : null}
              </span>
            ) : undefined
          }
          footer={totals ? closingText(totals.mode, day.closingCents) : undefined}
        >
          {day.rows.map((row) => (
            <LedgerRow
              key={row.key}
              rail={
                <LedgerRail
                  icon={ACTIVITY_ICONS[row.icon]}
                  swatch={row.treasuryId ? swatches?.[row.treasuryId] : undefined}
                />
              }
              title={row.title}
              href={row.path ? `${base}${row.path}` : undefined}
              meta={row.sub}
              amount={<Amount row={row} />}
              // De qué caja es va bajo la plata: a la izquierda queda solo qué pasó.
              amountNote={showTreasury && row.treasuryName ? row.treasuryName : undefined}
            />
          ))}
        </LedgerGroup>
      ))}
    </LedgerList>
  )
}

type Filter = 'all' | 'in' | 'out'

/**
 * Los movimientos de una caja con el filtro «Todo · Entró · Salió». El filtro
 * no pide nada: muestra u oculta lo ya cargado. Los totales del día y el saldo
 * de cierre son SIEMPRE los del día entero, también con el filtro puesto.
 */
export function CajaActivity({
  label,
  days,
  base,
  mode,
  empty,
}: {
  label: string
  days: readonly ActivityDay[]
  base: string
  /** `card`: la tarjeta de la empresa (pagos y consumos, y el saldo es una deuda). */
  mode: 'money' | 'card'
  /** Lo que se ve si no hay ningún movimiento (lo arma la página, con su paso siguiente). */
  empty: ReactNode
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const inLabel = mode === 'card' ? 'pagos' : 'entró'
  const outLabel = mode === 'card' ? 'consumos' : 'salió'
  if (days.length === 0) return <>{empty}</>

  const shown =
    filter === 'all'
      ? days
      : days
          .map((day) => ({ ...day, rows: day.rows.filter((row) => row.direction === filter) }))
          .filter((day) => day.rows.length > 0)

  const options: ReadonlyArray<{ value: Filter; label: string }> = [
    { value: 'all', label: 'Todo' },
    { value: 'in', label: mode === 'card' ? 'Pagos' : 'Entró' },
    { value: 'out', label: mode === 'card' ? 'Consumos' : 'Salió' },
  ]

  return (
    <div className="space-y-3">
      <fieldset className="mx-0 min-w-0 border-0 p-0">
        <legend className="sr-only">Qué movimientos se ven</legend>
        <div className="flex flex-wrap gap-1.5">
          {options.map((option) => (
            <Pill
              key={option.value}
              active={filter === option.value}
              onClick={() => setFilter(option.value)}
              className="h-11 px-4 text-sm md:pointer-fine:h-9 md:pointer-fine:px-3 md:pointer-fine:text-[13px]"
            >
              {option.label}
            </Pill>
          ))}
        </div>
      </fieldset>
      {shown.length === 0 ? (
        <p className="rounded-xl bg-secondary/50 px-4 py-6 text-center text-sm text-muted-foreground">
          {filter === 'in'
            ? mode === 'card'
              ? 'En este período no hubo pagos.'
              : 'En este período no entró plata.'
            : mode === 'card'
              ? 'En este período no hubo consumos.'
              : 'En este período no salió plata.'}
        </p>
      ) : (
        <ActivityDays label={label} days={shown} base={base} totals={{ mode, inLabel, outLabel }} />
      )}
    </div>
  )
}

/**
 * Lo que se ve cuando el período no tiene movimientos. Si la caja nunca se
 * movió, enseña qué la mueve sola y el paso que sigue; si tiene historia, lleva
 * al último mes en que pasó algo.
 *
 * El paso que sigue es una carga («Cargar lo que hay», «Cargar el cierre»,
 * «Mover plata»): quien solo lee ve el texto y ningún botón (`canWrite`). Vive
 * acá, y no en la página, para que ese resguardo tenga su test de render.
 */
export function CajaActivityEmpty({
  treasury,
  everMoved,
  lastMovementDate,
  periodLabel,
  methods,
  openingPending,
  base,
  canWrite,
}: {
  treasury: { id: string; name: string; kind: TreasuryKind }
  /** La caja tuvo algún movimiento alguna vez. */
  everMoved: boolean
  lastMovementDate: string | null
  /** «Septiembre 2026». */
  periodLabel: string
  /** Los medios de cobro que entran a esta caja («lo cobrado con: Efectivo»). */
  methods: readonly string[]
  /** Faltan los saldos iniciales: el paso de todas es cargar lo que hay. */
  openingPending: boolean
  /** `/<bar>/administracion`. */
  base: string
  canWrite: boolean
}) {
  if (everMoved) {
    const month = lastMovementDate ? monthOf(lastMovementDate) : null
    return (
      <EmptyTeach
        plain
        icon={ReceiptText}
        title={`No hubo movimientos en ${periodLabel.toLowerCase()}`}
      >
        {month ? (
          <Link
            href={hrefWith(`${base}/cajas/${treasury.id}`, { mes: month })}
            className="inline-flex min-h-11 items-center gap-1 rounded-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
          >
            Ir a {monthName(Number(month.slice(5, 7)))}, el último mes con movimientos
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        ) : (
          'Probá con otro período.'
        )}
      </EmptyTeach>
    )
  }
  const empty = cajaEmpty({
    kind: treasury.kind,
    name: treasury.name,
    methods,
    openingPending,
  })
  const action = !canWrite ? null : empty.action === 'opening' ? (
    <Button asChild className="h-11 gap-2">
      <Link href={`${base}/configurar`}>
        Cargar lo que hay
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </Button>
  ) : empty.action === 'close' ? (
    <Button asChild variant="outline" className="h-11 gap-2">
      <Link href={`${base}/ventas/cierre`}>
        Cargar el cierre
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </Button>
  ) : empty.action === 'move' ? (
    <ActionButton action="mover" params={{ caja: treasury.id }} variant="outline" className="h-11">
      Mover plata
    </ActionButton>
  ) : null
  return (
    <EmptyTeach plain icon={ReceiptText} title={empty.title} action={action ?? undefined}>
      {empty.text}
    </EmptyTeach>
  )
}
