import Link from 'next/link'
import type { AgingBucket } from '@/lib/accounting/aging'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import { Amount } from './amount'
import { plural } from './format'

/** Los cuatro tramos de la barra: lo que no venció y lo vencido por antigüedad. */
export const AGING_BAR_TRAMOS = ['al-dia', '1-30', '31-60', '60-mas'] as const
export type AgingBarTramo = (typeof AGING_BAR_TRAMOS)[number]

const TRAMO_LABEL: Readonly<Record<AgingBarTramo, string>> = {
  'al-dia': 'Al día',
  '1-30': 'Vencida 1 a 30 días',
  '31-60': 'Vencida 31 a 60 días',
  '60-mas': 'Vencida hace más de 60 días',
}

/** Cortito para la barra en pantallas chicas y el resumen accesible. */
const TRAMO_SHORT: Readonly<Record<AgingBarTramo, string>> = {
  'al-dia': 'al día',
  '1-30': 'vencida de 1 a 30 días',
  '31-60': 'de 31 a 60 días',
  '60-mas': 'más de 60 días',
}

const TRAMO_COLOR: Readonly<Record<AgingBarTramo, string>> = {
  'al-dia': 'bg-success',
  '1-30': 'bg-warning',
  '31-60': 'bg-destructive/60',
  '60-mas': 'bg-destructive',
}

const BUCKET_TO_TRAMO: Readonly<Record<AgingBucket, AgingBarTramo>> = {
  current: 'al-dia',
  soon: 'al-dia',
  'overdue-1-30': '1-30',
  'overdue-31-60': '31-60',
  'overdue-60-plus': '60-mas',
}

export type AgingBarProps = {
  /** La salida de `agingBuckets(items, today, soonDays)` de `@/lib/accounting/aging`. */
  buckets: ReadonlyArray<{ bucket: AgingBucket; cents: number; count: number }>
  /** «Deuda» (proveedores) o «Te deben» (cobrables): encabeza el resumen accesible. */
  title?: string
  /** Cada fila de la leyenda filtra la lista por tramo. Solo desde un Server Component. */
  hrefFor?: (tramo: AgingBarTramo) => string
  /** La leyenda ES la tabla (default `true`); `false` solo si al lado ya hay una tabla. */
  legend?: boolean
  className?: string
}

type Row = { tramo: AgingBarTramo; cents: number; count: number }

/** Junta los cinco tramos del motor en los cuatro de la barra («vence pronto» es al día). */
export function agingBarRows(buckets: AgingBarProps['buckets']): Row[] {
  const rows: Row[] = AGING_BAR_TRAMOS.map((tramo) => ({ tramo, cents: 0, count: 0 }))
  for (const b of buckets) {
    const row = rows[AGING_BAR_TRAMOS.indexOf(BUCKET_TO_TRAMO[b.bucket])]
    if (!row) continue
    row.cents += Math.max(0, b.cents)
    row.count += Math.max(0, b.count)
  }
  return rows
}

/**
 * Antigüedad de la deuda: barra proporcional (Al día · 1–30 · 31–60 · +60)
 * con la leyenda como tabla, así el tramo nunca depende solo del color.
 * Estática y server-safe.
 */
export function AgingBar({
  buckets,
  title = 'Deuda',
  hrefFor,
  legend = true,
  className,
}: AgingBarProps) {
  const rows = agingBarRows(buckets)
  const total = rows.reduce((sum, r) => sum + r.cents, 0)
  const summary =
    total > 0
      ? `${title} ${formatCents(total)}: ${rows
          .filter((r) => r.cents > 0)
          .map((r) => `${TRAMO_SHORT[r.tramo]} ${formatCents(r.cents)}`)
          .join('; ')}`
      : `${title}: sin saldo`

  return (
    <div className={cn('space-y-3', className)}>
      <div
        role="img"
        aria-label={summary}
        className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-secondary"
      >
        {total > 0
          ? rows
              .filter((r) => r.cents > 0)
              .map((r) => (
                <span
                  key={r.tramo}
                  className={cn(
                    'h-full min-w-1 first:rounded-l-full last:rounded-r-full',
                    TRAMO_COLOR[r.tramo],
                  )}
                  style={{ width: `${(r.cents / total) * 100}%` }}
                />
              ))
          : null}
      </div>

      {legend ? (
        <table className="w-full text-sm">
          <caption className="sr-only">{`${title} por antigüedad`}</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Tramo</th>
              <th scope="col">Importe</th>
              <th scope="col">Comprobantes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {rows.map((r) => {
              const label = (
                <span className="inline-flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn('size-2 shrink-0 rounded-full', TRAMO_COLOR[r.tramo])}
                  />
                  {TRAMO_LABEL[r.tramo]}
                </span>
              )
              // En el celular la cantidad va debajo del tramo: como tercera columna
              // dejaba «Vencida hace más de 60 días» en tres renglones.
              const countText = r.count > 0 ? plural(r.count, 'comprobante', 'comprobantes') : null
              return (
                <tr key={r.tramo} className={cn(r.cents === 0 && 'text-muted-foreground')}>
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    {hrefFor && r.cents > 0 ? (
                      <Link
                        href={hrefFor(r.tramo)}
                        className="rounded-sm underline-offset-4 outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {label}
                      </Link>
                    ) : (
                      label
                    )}
                    {countText ? (
                      <span className="block pl-4 text-xs text-muted-foreground sm:hidden">
                        {countText}
                      </span>
                    ) : null}
                  </th>
                  <td className="py-2 text-right">
                    <Amount cents={r.cents} className={cn(r.cents > 0 && 'font-medium')} />
                  </td>
                  <td className="hidden w-28 py-2 pl-3 text-right text-xs text-muted-foreground sm:table-cell">
                    {countText ?? '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  )
}
