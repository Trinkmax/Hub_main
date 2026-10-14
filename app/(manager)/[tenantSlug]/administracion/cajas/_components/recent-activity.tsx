import { Panel, PanelError } from '@/components/administracion/kit'
import { Skeleton } from '@/components/ui/skeleton'
import type { SubledgerPage } from '@/lib/accounting/queries/books'
import type { QueryOutcome } from '@/lib/accounting/queries/shared'
import type { TreasuryKind } from '@/lib/accounting/types'
import { formatDayMonth } from '@/lib/dates'
import { cn } from '@/lib/utils'
import {
  activityFromMovement,
  groupByDay,
  mergeTransfers,
  movementFromSubledger,
} from '../_lib/activity'
import { ActivityDays } from '../[id]/_components/caja-activity'

/** Cuántos días mira «Últimos movimientos» hacia atrás (con hoy). */
export const RECENT_DAYS = 14
/** Cuántos renglones se muestran: en la compu y en el celular. */
const SHOWN = 8
const SHOWN_NARROW = 6

const TITLE = 'Últimos movimientos'
const DESCRIPTION = 'De todas las cajas, lo más nuevo arriba.'
const FOOTER = 'Para ver todo lo de una caja, tocá su tarjeta.'

/**
 * «Últimos movimientos»: lo que pasó en las cajas en las últimas dos semanas,
 * contado en palabras y agrupado por día. Es la «actividad» de una billetera,
 * no un libro: ocho renglones y a otra cosa.
 *
 * - Un pasaje entre cajas llega como dos líneas y se muestra UNA vez.
 * - `page === null`: la página no pidió nada porque ninguna caja se movió en
 *   esos días (se dice cuándo fue el último).
 * - Si en dos semanas hubo más movimientos de los que entran en una lectura, no
 *   se muestra una lista que no es la más nueva: se manda a mirar cada caja.
 */
export async function RecentActivity({
  page,
  base,
  today,
  swatches,
  kinds,
  lastMovementDate,
  className,
}: {
  page: Promise<QueryOutcome<SubledgerPage>> | null
  /** `/<bar>/administracion`. */
  base: string
  today: string
  /** El color de cada caja (`bg-*`), por id. */
  swatches: Readonly<Record<string, string>>
  /** El tipo de cada caja, por id: un conteo se cuenta distinto en efectivo que en un banco. */
  kinds: Readonly<Record<string, TreasuryKind>>
  /** El día del último movimiento de cualquier caja. */
  lastMovementDate: string | null
  className?: string
}) {
  const quiet = (text: string) => (
    <Panel title={TITLE} description={DESCRIPTION} footer={FOOTER} className={className}>
      <p className="rounded-xl bg-secondary/50 px-4 py-6 text-sm text-muted-foreground text-pretty">
        {text}
      </p>
    </Panel>
  )

  if (page === null) {
    return quiet(
      lastMovementDate
        ? `No hubo movimientos en los últimos ${RECENT_DAYS} días. El último fue el ${formatDayMonth(lastMovementDate)}.`
        : 'Todavía no hubo movimientos en las cajas.',
    )
  }
  const outcome = await page
  if (!outcome.ok) {
    return <PanelError title={TITLE} message={outcome.message} className={className} />
  }
  if (outcome.data.nextCursor) {
    return quiet('Hubo muchos movimientos estos días: miralos en cada caja.')
  }

  const rows = mergeTransfers(
    outcome.data.rows
      .map((row, index) => movementFromSubledger(row, index))
      .filter((m) => m !== null)
      .map((m) =>
        activityFromMovement(m, { view: 'all', kindOf: (id) => (id ? (kinds[id] ?? null) : null) }),
      ),
  )
  if (rows.length === 0) {
    return quiet(`No hubo movimientos en los últimos ${RECENT_DAYS} días.`)
  }

  const list = (count: number, visibility: string) => (
    <ActivityDays
      label={TITLE}
      days={groupByDay(rows.slice(-count), { today, newestFirst: true })}
      base={base}
      swatches={swatches}
      showTreasury
      className={visibility}
    />
  )

  return (
    <Panel title={TITLE} description={DESCRIPTION} footer={FOOTER} className={className}>
      {/* En el celular entran seis; con lugar, ocho. Una sola de las dos listas se ve. */}
      {rows.length > SHOWN_NARROW ? (
        <>
          {list(SHOWN_NARROW, 'sm:hidden')}
          {list(SHOWN, 'max-sm:hidden')}
        </>
      ) : (
        list(SHOWN, '')
      )}
    </Panel>
  )
}

/** Con la forma real: el título y cinco renglones con su margen. */
export function RecentActivitySkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'card-hairline space-y-4 rounded-2xl border bg-card p-4 shadow-xs sm:p-5',
        className,
      )}
    >
      <div className="space-y-2">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-4 w-56 max-w-full" />
      </div>
      <div className="divide-y divide-border/60">
        {['a', 'b', 'c', 'd', 'e'].map((key) => (
          <div key={key} className="flex items-center gap-3 py-3">
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-32 max-w-full" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-4 w-20 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}
