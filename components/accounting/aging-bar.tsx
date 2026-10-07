import Link from 'next/link'
import type * as React from 'react'
import { Amount } from '@/components/ui/amount'
import { AGING_BUCKETS, type AgingBucket, DEFAULT_SOON_DAYS } from '@/lib/accounting/aging'
import { formatCents } from '@/lib/money/format'
import { cn } from '@/lib/utils'

export type { AgingBucket } from '@/lib/accounting/aging'

export type AgingBarBucket = { bucket: AgingBucket; cents: number | bigint; count?: number }

export type AgingBarProps = Omit<React.ComponentProps<'div'>, 'children'> & {
  /** Los tramos de `agingBuckets(items, today)` (o de la consulta). El orden no importa; el que falta vale 0. */
  buckets: readonly AgingBarBucket[]
  /**
   * La deuda total, de la consulta. Default: la suma de los tramos. Si es
   * mayor (partidas sin vencimiento, que no van en la barra), el resumen para
   * el lector lo dice.
   */
  totalCents?: number | bigint
  /** Cada fila de la leyenda pasa a ser un link que filtra la lista por tramo (solo desde el server). */
  hrefFor?: (bucket: AgingBucket) => string
  /** Default `full` (obligatoria salvo con una tabla al lado) · `compact` (celular) · `none`. */
  legend?: 'full' | 'compact' | 'none'
  /** `sm` 8 px · `md` 12 px (default) de alto. */
  size?: 'sm' | 'md'
  /** `due_soon_days` del bar (default 7): «Vence en 7 días». */
  soonDays?: number
  /** Default 2: lo contable no esconde centavos. 0 al lado de KPIs redondeados. */
  decimals?: 0 | 2
  /** Cómo empieza el resumen para el lector. Default «Deuda total». */
  totalLabel?: string
  /** Default «1 comprobante» / «3 comprobantes». */
  countLabel?: (count: number) => string
}

/** Los colores validados como cinco tramos contiguos (kit §2.7): CVD peor 10,5 en claro, 8,8 en oscuro. */
const BUCKET_COLOR: Readonly<Record<AgingBucket, string>> = {
  current: 'bg-aging-current',
  soon: 'bg-aging-soon',
  'overdue-1-30': 'bg-aging-1-30',
  'overdue-31-60': 'bg-aging-31-60',
  'overdue-60-plus': 'bg-aging-60-plus',
}

/** La etiqueta de un tramo: el texto que acompaña siempre al color. */
export function agingBucketLabel(
  bucket: AgingBucket,
  soonDays: number = DEFAULT_SOON_DAYS,
): string {
  switch (bucket) {
    case 'current':
      return 'Al día'
    case 'soon':
      return soonDays === 1 ? 'Vence mañana' : `Vence en ${soonDays.toString()} días`
    case 'overdue-1-30':
      return 'Vencida de 1 a 30 días'
    case 'overdue-31-60':
      return 'Vencida de 31 a 60 días'
    case 'overdue-60-plus':
      return 'Vencida hace más de 60 días'
  }
}

function defaultCountLabel(count: number): string {
  return count === 1 ? '1 comprobante' : `${count.toString()} comprobantes`
}

function toBigInt(value: number | bigint): bigint {
  if (typeof value === 'bigint') return value
  if (!Number.isFinite(value)) return 0n
  return BigInt(value < 0 ? -Math.round(-value) : Math.round(value))
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

type Resolved = { bucket: AgingBucket; cents: bigint; count: number | undefined; label: string }

/**
 * El resumen que lee el lector en lugar de la barra (`role="img"`):
 * «Deuda total $ 1.240.000,00: al día $ 860.000,00; vencida de 1 a 30 días
 * $ 380.000,00». Solo los tramos con algo; sin deuda, «Sin deuda».
 */
export function agingSummaryLabel(
  buckets: readonly AgingBarBucket[],
  opts: {
    totalCents?: number | bigint
    soonDays?: number
    decimals?: 0 | 2
    totalLabel?: string
  } = {},
): string {
  const resolved = resolveBuckets(buckets, opts.soonDays ?? DEFAULT_SOON_DAYS)
  return summaryOf(resolved, opts)
}

function resolveBuckets(buckets: readonly AgingBarBucket[], soonDays: number): Resolved[] {
  return AGING_BUCKETS.map((bucket) => {
    let cents = 0n
    let count: number | undefined
    for (const item of buckets) {
      if (item.bucket !== bucket) continue
      cents += toBigInt(item.cents)
      if (item.count !== undefined) count = (count ?? 0) + item.count
    }
    return { bucket, cents, count, label: agingBucketLabel(bucket, soonDays) }
  })
}

function summaryOf(
  resolved: readonly Resolved[],
  opts: { totalCents?: number | bigint; decimals?: 0 | 2; totalLabel?: string },
): string {
  const decimals = opts.decimals ?? 2
  const inBar = resolved.reduce((acc, item) => acc + (item.cents > 0n ? item.cents : 0n), 0n)
  const total = opts.totalCents === undefined ? inBar : toBigInt(opts.totalCents)
  if (total <= 0n && inBar === 0n) return 'Sin deuda'
  const parts = resolved
    .filter((item) => item.cents > 0n)
    .map((item) => `${lowerFirst(item.label)} ${formatCents(item.cents, { decimals })}`)
  if (total > inBar) parts.push(`sin vencimiento ${formatCents(total - inBar, { decimals })}`)
  const head = `${opts.totalLabel ?? 'Deuda total'} ${formatCents(total, { decimals })}`
  return parts.length > 0 ? `${head}: ${parts.join('; ')}` : head
}

/** Lo mismo que el link de una fila de tabla: pelo al pasar, presionado sin escala, foco adentro. */
const LEGEND_LINK =
  'rounded-md outline-offset-2 outline-(--ring) hover:bg-hover active:bg-(--active) focus-visible:outline-2'

/**
 * La antigüedad de la deuda (kit §3.8): cinco tramos contiguos (al día, vence
 * en 7 días, vencida de 1 a 30, de 31 a 60 y más de 60) con la paleta
 * `--aging-*`, rehecha para que «vence pronto» y «1 a 30» se distingan también
 * con daltonismo. Server-safe y estática (sin animación).
 *
 * - **Barra:** `rounded-full`, cada tramo proporcional con un mínimo de 4 px
 *   si no es cero y 2 px de separación del color de la superficie.
 * - **Accesibilidad:** la barra es `role="img"` con un resumen en palabras; la
 *   leyenda es la tabla (muestra + etiqueta + importe + cantidad): la identidad
 *   nunca depende solo del color. En alto contraste los fondos se borran: la
 *   leyenda queda.
 * - **Leyenda:** una fila por tramo; con `hrefFor`, cada fila con deuda es un
 *   link que filtra la lista por tramo.
 */
function AgingBar({
  buckets,
  totalCents,
  hrefFor,
  legend = 'full',
  size = 'md',
  soonDays = DEFAULT_SOON_DAYS,
  decimals = 2,
  totalLabel,
  countLabel = defaultCountLabel,
  className,
  ...props
}: AgingBarProps) {
  const resolved = resolveBuckets(buckets, soonDays)
  const inBar = resolved.reduce((acc, item) => acc + (item.cents > 0n ? item.cents : 0n), 0n)
  const summary = summaryOf(resolved, { totalCents, decimals, totalLabel })
  const segments = resolved.filter((item) => item.cents > 0n)

  return (
    <div data-slot="aging-bar" className={cn('flex min-w-0 flex-col gap-3', className)} {...props}>
      <div
        role="img"
        aria-label={summary}
        data-slot="aging-bar-track"
        className={cn(
          'flex w-full gap-0.5 overflow-hidden rounded-full',
          size === 'sm' ? 'h-2' : 'h-3',
          inBar === 0n && 'bg-muted',
        )}
      >
        {segments.map((item) => (
          <span
            key={item.bucket}
            data-slot="aging-bar-segment"
            data-bucket={item.bucket}
            className={cn(
              'h-full min-w-1',
              // En alto contraste el sistema borra los fondos: el tramo queda en
              // tinta del sistema y la separación de 2 px los sigue distinguiendo.
              'forced-colors:bg-[CanvasText] forced-colors:forced-color-adjust-none',
              BUCKET_COLOR[item.bucket],
            )}
            // Proporcional al importe: lo que sobra después de los mínimos y los 2 px de separación.
            style={{ flex: `${Number(item.cents) / Number(inBar)} 1 0%` }}
          />
        ))}
      </div>
      {legend === 'full' ? (
        // Una tabla angosta: en una pantalla ancha la cifra no se va lejos de su etiqueta.
        <ul data-slot="aging-bar-legend" data-legend="full" className="grid max-w-xl gap-0.5">
          {resolved.map((item) => {
            const empty = item.cents <= 0n
            const content = (
              <>
                <span
                  aria-hidden="true"
                  className={cn('size-2 shrink-0 rounded-[2px]', BUCKET_COLOR[item.bucket])}
                />
                <span className="grid min-w-0 flex-1">
                  <span className="type-small text-foreground">{item.label}</span>
                  {item.count !== undefined ? (
                    // En el celular la cantidad va debajo de la etiqueta (no entra al costado).
                    <span className="type-caption text-muted-foreground sm:hidden">
                      {countLabel(item.count)}
                    </span>
                  ) : null}
                </span>
                <Amount
                  cents={item.cents}
                  decimals={decimals}
                  className={cn('type-small', empty ? 'text-muted-foreground' : 'font-medium')}
                />
                {item.count !== undefined ? (
                  <span className="w-28 shrink-0 text-end type-caption text-muted-foreground max-sm:hidden">
                    {countLabel(item.count)}
                  </span>
                ) : null}
              </>
            )
            const href = !empty && hrefFor ? hrefFor(item.bucket) : undefined
            return (
              <li key={item.bucket} data-slot="aging-bar-legend-item" data-bucket={item.bucket}>
                {href !== undefined ? (
                  <Link
                    href={href}
                    className={cn('flex min-h-8 items-center gap-2 px-2 py-1', LEGEND_LINK)}
                  >
                    {content}
                  </Link>
                ) : (
                  <div className="flex min-h-8 items-center gap-2 px-2 py-1">{content}</div>
                )}
              </li>
            )
          })}
        </ul>
      ) : legend === 'compact' ? (
        <ul
          data-slot="aging-bar-legend"
          data-legend="compact"
          className="flex flex-wrap gap-x-4 gap-y-1"
        >
          {segments.map((item) => {
            const content = (
              <>
                <span
                  aria-hidden="true"
                  className={cn('size-2 shrink-0 rounded-[2px]', BUCKET_COLOR[item.bucket])}
                />
                <span className="type-caption text-muted-foreground">{item.label}</span>
                <Amount
                  cents={item.cents}
                  decimals={decimals}
                  className="type-caption font-medium text-foreground"
                />
              </>
            )
            const href = hrefFor ? hrefFor(item.bucket) : undefined
            return (
              <li
                key={item.bucket}
                data-slot="aging-bar-legend-item"
                data-bucket={item.bucket}
                className="flex items-center"
              >
                {href !== undefined ? (
                  <Link
                    href={href}
                    className={cn(
                      'relative inline-flex items-center gap-1.5 hit-area',
                      LEGEND_LINK,
                    )}
                  >
                    {content}
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1.5">{content}</span>
                )}
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

export { AgingBar }
