import Link from 'next/link'
import { SplitBar } from '@/components/administracion/charts/split-bar'
import { Panel, PanelError } from '@/components/administracion/kit'
import { Skeleton } from '@/components/ui/skeleton'
import type { TreasuryCheck } from '@/lib/accounting/queries/forms'
import type { QueryOutcome } from '@/lib/accounting/queries/shared'
import { formatDayMonth } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'

/** Cuántas ventas en camino se listan antes de resumir el resto. */
const MAX_ITEMS = 5

/** Link adentro de una oración: en el celular el relleno agranda el toque sin separar los renglones. */
const LINK =
  'rounded-sm font-medium text-foreground underline decoration-border underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring max-sm:py-3'

/**
 * «En camino»: lo vendido con QR o transferencia que todavía no se confirmó
 * que entró a la billetera. Dice cuánto es, desde cuándo, cuánto se va a quedar
 * la billetera (estimado con sus tasas) y cómo se confirma.
 *
 * No trae un botón propio: el de la pantalla es «Ya me entró», en la tarjeta de
 * arriba. Acá queda el otro camino, subir el reporte.
 */
export async function PendingBlock({
  check,
  name,
  balanceCents,
  pendingCents,
  swatch,
  base,
  canWrite,
}: {
  check: Promise<QueryOutcome<TreasuryCheck | null>>
  /** El nombre de la billetera. */
  name: string
  /** Lo que ya está disponible en la billetera. */
  balanceCents: number
  pendingCents: number
  /** El color de la caja (`bg-*`). */
  swatch: string
  /** `/<bar>/administracion`. */
  base: string
  canWrite: boolean
}) {
  const title = `Hay ${formatCentsShort(pendingCents)} en camino`
  const outcome = await check
  if (!outcome.ok) return <PanelError title={title} message={outcome.message} />

  const data = outcome.data
  const items = (data?.openWalletItems ?? []).filter((item) => item.openCents > 0)
  const since = items.reduce<string | null>(
    (min, item) =>
      item.accountingDate !== null && (min === null || item.accountingDate < min)
        ? item.accountingDate
        : min,
    null,
  )
  const estimates = data?.estimates ?? null
  const kept = estimates
    ? estimates.commissionCents + estimates.commissionVatCents + estimates.sircupaCents
    : 0
  const shown = items.slice(0, MAX_ITEMS)
  const rest = items.length - shown.length

  return (
    <Panel
      title={title}
      description={
        <>
          Son ventas con QR o transferencia
          {since ? ` desde el ${formatDayMonth(since)}` : ''} que todavía no confirmaste.
          {kept > 0
            ? ` Cuando entren, ${name} se va a quedar con unos ${formatCentsShort(kept)} (estimado con tus tasas).`
            : ''}
        </>
      }
      footer={
        canWrite ? (
          <>
            Se confirma con «Ya me entró», o{' '}
            <Link href={`${base}/importar/mercado-pago`} className={LINK}>
              subí el reporte
            </Link>{' '}
            y se anota solo.
          </>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <SplitBar
          segments={[
            { key: 'disponible', label: 'Disponible', cents: Math.max(0, balanceCents), swatch },
            { key: 'en-camino', label: 'En camino', cents: pendingCents, swatch, hatched: true },
          ]}
          ariaLabel={`${name}: ${formatCentsShort(Math.max(0, balanceCents))} disponibles y ${formatCentsShort(pendingCents)} en camino.`}
        />
        {shown.length > 0 ? (
          <ul aria-label="Ventas en camino" className="divide-y divide-border/60 text-sm">
            {shown.map((item) => (
              <li key={item.lineId} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="font-medium">{item.method || 'Venta'}</span>
                  {item.accountingDate ? (
                    <span className="text-muted-foreground">
                      {' '}
                      · {formatDayMonth(item.accountingDate)}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 tabular-nums">{formatCentsShort(item.openCents)}</span>
              </li>
            ))}
            {rest > 0 ? (
              <li className="py-2 text-muted-foreground">
                y {rest === 1 ? '1 más' : `${rest} más`}
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </Panel>
  )
}

/** Con la forma real: el título, la barra partida y tres renglones. */
export function PendingSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="card-hairline space-y-4 rounded-2xl border bg-card p-4 shadow-xs sm:p-5"
    >
      <div className="space-y-2">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-4 w-full max-w-lg" />
      </div>
      <Skeleton className="h-3 w-full rounded-full" />
      {['a', 'b', 'c'].map((key) => (
        <div key={key} className="flex items-center justify-between gap-3">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3.5 w-20" />
        </div>
      ))}
    </div>
  )
}
